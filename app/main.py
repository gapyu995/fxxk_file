from __future__ import annotations

import asyncio
import shutil
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from app.config import get_settings, save_translation_settings
from app.services.extractor import ExtractionError, SUPPORTED_EXTENSIONS, extract_paragraphs
from app.services.glossary import load_style_guide, load_terms, relevant_terms
from app.services.segmenter import detect_language, split_into_segments
from app.services.storage import (
    GLOSSARIES,
    ORIGINALS,
    STATIC,
    archive_document_record,
    create_docx_exports,
    create_original_preview,
    create_translated_docx,
    ensure_directories,
    finalize_and_clear_document_records,
    list_documents,
    load_document,
    safe_filename,
    save_document,
    utc_now,
)
from app.services.translator import TranslationError, translate_batch


MAX_UPLOAD_BYTES = 80 * 1024 * 1024
active_tasks: dict[str, asyncio.Task] = {}


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_directories()
    yield
    tasks = list(active_tasks.values())
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    active_tasks.clear()
    await asyncio.to_thread(finalize_and_clear_document_records)


app = FastAPI(title="fxxk_file", version="1.3.0", lifespan=lifespan)


class TranslationRequest(BaseModel):
    source_language: Literal["zh", "en"]
    target_language: Literal["zh", "en"]
    overwrite: bool = False


class SegmentUpdate(BaseModel):
    source: str | None = Field(default=None, max_length=30000)
    translation: str | None = Field(default=None, max_length=30000)
    locked: bool | None = None
    reviewed: bool | None = None


class SettingsUpdate(BaseModel):
    api_key: str = Field(default="", max_length=1000)
    base_url: str = Field(min_length=4, max_length=1000)
    model: str = Field(min_length=1, max_length=200)
    protocol: Literal["openai", "anthropic"] = "openai"
    use_system_proxy: bool = False
    batch_size: int = Field(default=3, ge=1, le=10)
    request_char_limit: int = Field(default=6000, ge=500, le=20000)
    max_retries: int = Field(default=5, ge=0, le=10)
    clear_key: bool = False


class AutosaveRequest(BaseModel):
    translations: dict[str, str] = Field(default_factory=dict)


@app.get("/", include_in_schema=False)
async def web_index():
    return FileResponse(
        STATIC / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "translation_configured": get_settings().translation_configured}


@app.get("/api/settings")
async def read_settings() -> dict:
    settings = get_settings()
    return {
        "configured": settings.translation_configured,
        "has_api_key": bool(settings.api_key),
        "base_url": settings.base_url,
        "model": settings.model,
        "protocol": settings.protocol,
        "use_system_proxy": settings.use_system_proxy,
        "batch_size": settings.batch_size,
        "request_char_limit": settings.request_char_limit,
        "max_retries": settings.max_retries,
    }


@app.put("/api/settings")
async def update_settings(body: SettingsUpdate) -> dict:
    current = get_settings()
    api_key = "" if body.clear_key else (body.api_key.strip() or current.api_key)
    if not body.base_url.startswith(("http://", "https://")):
        raise HTTPException(400, "接口地址必须以 http:// 或 https:// 开头。")
    save_translation_settings(
        api_key,
        body.base_url,
        body.model,
        body.protocol,
        body.use_system_proxy,
        body.batch_size,
        body.request_char_limit,
        body.max_retries,
    )
    updated = get_settings()
    return {"configured": updated.translation_configured, "has_api_key": bool(updated.api_key)}


@app.get("/api/documents")
async def documents() -> list[dict]:
    return list_documents()


@app.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    source_language: str = Form("auto"),
    target_language: str = Form("auto"),
) -> dict:
    original_name = safe_filename(file.filename or "document")
    suffix = Path(original_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise HTTPException(415, f"不支持该格式。可上传：{', '.join(sorted(SUPPORTED_EXTENSIONS))}")

    document_id = uuid.uuid4().hex[:12]
    inbox_path = ORIGINALS / f"{document_id}_{original_name}"
    size = 0
    try:
        with inbox_path.open("wb") as handle:
            while chunk := await file.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_UPLOAD_BYTES:
                    raise HTTPException(413, "文件超过 80 MB 限制。")
                handle.write(chunk)
        paragraphs = await asyncio.to_thread(extract_paragraphs, inbox_path)
        # Keep one translation segment per Word paragraph/table cell so the
        # translated DOCX can be written back into a copy of the original.
        # This preserves pictures and the surrounding document layout.
        segment_texts = paragraphs if suffix in {".doc", ".docx"} else split_into_segments(paragraphs)
    except ExtractionError as exc:
        inbox_path.unlink(missing_ok=True)
        raise HTTPException(422, str(exc)) from exc
    except HTTPException:
        inbox_path.unlink(missing_ok=True)
        raise
    except Exception as exc:
        inbox_path.unlink(missing_ok=True)
        raise HTTPException(500, f"处理文件失败：{exc}") from exc
    finally:
        await file.close()

    if not segment_texts:
        inbox_path.unlink(missing_ok=True)
        raise HTTPException(422, "文件中没有发现可翻译文字。")

    detected = detect_language("\n".join(segment_texts[:30]))
    source = source_language if source_language in {"zh", "en"} else detected
    default_target = "en" if source == "zh" else "zh"
    target = target_language if target_language in {"zh", "en"} else default_target
    if source == target:
        target = "en" if source == "zh" else "zh"

    now = utc_now()
    document = {
        "id": document_id,
        "name": original_name,
        "original_path": str(inbox_path.relative_to(ORIGINALS.parent)),
        "source_language": source,
        "target_language": target,
        "detected_language": detected,
        "status": "ready",
        "progress": 0,
        "error": "",
        "retry": None,
        "created_at": now,
        "updated_at": now,
        "segments": [
            {
                "id": f"s{index:04d}",
                "source": text,
                "translation": "",
                "status": "empty",
                "locked": False,
            }
            for index, text in enumerate(segment_texts, 1)
        ],
    }
    save_document(document)
    return document


@app.get("/api/documents/{document_id}")
async def get_document(document_id: str) -> dict:
    return _load_or_404(document_id)


@app.delete("/api/documents/{document_id}")
async def delete_document_record(document_id: str) -> dict:
    document = _load_or_404(document_id)
    running = active_tasks.pop(document_id, None)
    if running and not running.done():
        running.cancel()
        try:
            await running
        except asyncio.CancelledError:
            pass
    archived = await asyncio.to_thread(archive_document_record, document_id)
    return {
        "ok": True,
        "message": "最近文档记录已删除，原件和译文文件均已保留。",
        "name": document["name"],
        "record_archive_path": str(archived.resolve()),
        "original_path": document.get("original_path", ""),
    }


@app.get("/api/documents/{document_id}/original")
async def get_original(document_id: str):
    document = _load_or_404(document_id)
    path = (ORIGINALS.parent / document["original_path"]).resolve()
    try:
        path.relative_to(ORIGINALS.resolve())
    except ValueError:
        raise HTTPException(400, "原文件路径无效。")
    if not path.is_file():
        raise HTTPException(404, "原文件不存在。")
    return FileResponse(path, filename=document["name"])


@app.get("/api/documents/{document_id}/preview")
async def preview_original(document_id: str):
    document = _load_or_404(document_id)
    suffix = Path(document["name"]).suffix.lower()
    if suffix == ".docx":
        return HTMLResponse(_docx_preview_page(document_id))
    path = await asyncio.to_thread(create_original_preview, document)
    if path:
        return HTMLResponse(_pdf_preview_page(document_id))
    return HTMLResponse(
        """<!doctype html><html lang='zh-CN'><meta charset='utf-8'><style>
        body{height:100vh;margin:0;display:grid;place-items:center;background:#eef1ef;color:#5f6c65;
        font:14px/1.8 system-ui,'Microsoft YaHei',sans-serif;text-align:center}.box{max-width:430px;padding:28px}
        strong{display:block;color:#26352d;font-size:16px;margin-bottom:8px}</style>
        <body><div class='box'><strong>旧版 DOC 无法直接预览</strong>
        二进制 DOC 需要先转换为 DOCX。请安装 LibreOffice，或在 Word/WPS 中另存为 DOCX 后重新拖入；
        DOCX 已可由程序内置渲染器直接显示。</div>
        <script>if(parent!==window)parent.postMessage({type:'fxxk_file-preview-error',
        message:'旧版 DOC 暂无分页预览'},'*');</script></body></html>"""
    )


@app.get("/api/documents/{document_id}/preview-pdf")
async def preview_pdf_file(document_id: str):
    document = _load_or_404(document_id)
    path = await asyncio.to_thread(create_original_preview, document)
    if not path or not path.is_file():
        raise HTTPException(404, "无法生成 PDF 分页预览。")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Cache-Control": "no-store"},
    )


def _docx_preview_page(document_id: str) -> str:
    return """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>DOCX 原件预览</title>
<script src="/vendor/jszip.min.js"></script>
<script src="/vendor/docx-preview.min.js"></script>
<style>
html,body{min-height:100%;margin:0;background:#dfe4e1;color:#33413a;font-family:system-ui,'Microsoft YaHei',sans-serif}
#loading{position:fixed;inset:0;z-index:10;display:grid;place-items:center;background:#eef1ef}
#loading .box{padding:24px 30px;border-radius:10px;background:white;box-shadow:0 8px 30px #26352d18;text-align:center}
#loading strong{display:block;margin-bottom:7px;color:#213029}#loading span{font-size:12px;color:#718078}
#preview{min-height:100vh}#preview .docx-wrapper{padding:24px 12px;background:#dfe4e1}
#preview section.docx{margin:0 auto 18px;box-shadow:0 3px 18px #26352d30}
.error{color:#a13a35!important;max-width:520px;line-height:1.7}
</style></head><body>
<div id="loading"><div class="box"><strong>正在载入 DOCX 原件</strong><span>文字、表格和图片将在本机浏览器中渲染</span></div></div>
<div id="preview"></div>
<script>
(async()=>{
  const loading=document.getElementById('loading');
  let pageElements=[];
  let pageOffsets=[0];
  let scrollFrame=0;
  let applyingSync=false;
  let releaseTimer=0;
  let previewZoom=1;

  function refreshPages(){
    pageElements=[...document.querySelectorAll('#preview section.docx')];
    pageOffsets=pageElements.length
      ? pageElements.map(page=>page.getBoundingClientRect().top+window.scrollY)
      : [0];
  }

  function currentPage(){
    const marker=window.scrollY+window.innerHeight*0.38;
    let low=0;
    let high=pageOffsets.length-1;
    let found=0;
    while(low<=high){
      const middle=(low+high)>>1;
      if(pageOffsets[middle]<=marker){
        found=middle;
        low=middle+1;
      }else{
        high=middle-1;
      }
    }
    return found+1;
  }

  function postPosition(kind){
    if(parent===window)return;
    const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    parent.postMessage({
      type:kind==='scroll'?'fxxk_file-preview-scroll':'fxxk_file-preview-ready',
      ratio:maxScroll?window.scrollY/maxScroll:0,
      page:currentPage(),
      pages:Math.max(1,pageElements.length)
    },'*');
  }

  function onScroll(){
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{
      scrollFrame=0;
      postPosition(applyingSync?'ready':'scroll');
    });
  }

  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',()=>{
    refreshPages();
    postPosition('ready');
  });
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==parent||!message)return;
    if(message.type==='fxxk_file-preview-zoom'){
      const maxScrollBefore=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
      const ratio=maxScrollBefore?window.scrollY/maxScrollBefore:0;
      previewZoom=Math.max(.6,Math.min(2,Number(message.zoom)||1));
      document.getElementById('preview').style.zoom=String(previewZoom);
      requestAnimationFrame(()=>{
        refreshPages();
        const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
        window.scrollTo(0,ratio*maxScroll);
        postPosition('ready');
      });
      return;
    }
    if(message.type!=='fxxk_file-sync-scroll')return;
    const ratio=Math.max(0,Math.min(1,Number(message.ratio)||0));
    const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    applyingSync=true;
    clearTimeout(releaseTimer);
    window.scrollTo(0,ratio*maxScroll);
    requestAnimationFrame(()=>requestAnimationFrame(()=>postPosition('ready')));
    releaseTimer=setTimeout(()=>{applyingSync=false;},140);
  });

  try{
    if(!window.docx) throw new Error('内置 DOCX 渲染器未加载');
    const response=await fetch('/api/documents/__DOCUMENT_ID__/original',{cache:'no-store'});
    if(!response.ok) throw new Error('读取原文件失败（HTTP '+response.status+'）');
    const data=await response.arrayBuffer();
    await window.docx.renderAsync(data,document.getElementById('preview'),null,{
      className:'docx',inWrapper:true,ignoreWidth:false,ignoreHeight:false,ignoreFonts:false,
      breakPages:true,ignoreLastRenderedPageBreak:false,experimental:true,useBase64URL:true,
      renderHeaders:true,renderFooters:true,renderFootnotes:true
    });
    loading.remove();
    requestAnimationFrame(()=>{
      refreshPages();
      postPosition('ready');
    });
  }catch(error){
    loading.querySelector('strong').textContent='DOCX 原件渲染失败';
    const detail=loading.querySelector('span');detail.className='error';detail.textContent=error.message;
    if(parent!==window)parent.postMessage({
      type:'fxxk_file-preview-error',
      message:'DOCX 原件渲染失败'
    },'*');
  }
})();
</script></body></html>""".replace("__DOCUMENT_ID__", document_id)


def _pdf_preview_page(document_id: str) -> str:
    return """<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>PDF 原件预览</title>
<script src="/vendor/pdf.min.js"></script>
<style>
html,body{min-height:100%;margin:0;background:#dfe4e1;color:#33413a;font-family:system-ui,'Microsoft YaHei',sans-serif}
body{overflow:auto}
#loading{position:fixed;inset:0;z-index:20;display:grid;place-items:center;background:#eef1ef}
#loading .box{max-width:520px;padding:24px 30px;border-radius:10px;background:white;box-shadow:0 8px 30px #26352d18;text-align:center}
#loading strong{display:block;margin-bottom:7px;color:#213029}
#loading span{font-size:12px;color:#718078;line-height:1.7}
#pages{display:flex;flex-direction:column;align-items:center;gap:18px;width:max-content;min-width:100%;padding:20px 14px 40px;box-sizing:border-box}
.pdf-page{position:relative;width:min(calc(100vw - 28px),900px);aspect-ratio:var(--page-ratio,612 / 792);overflow:hidden;background:white;box-shadow:0 3px 18px #26352d30}
.pdf-page canvas{display:block;width:100%;height:100%;background:white}
.page-placeholder{position:absolute;inset:0;display:grid;place-items:center;color:#93a09a;background:linear-gradient(135deg,#fff,#f7f9f8);font-size:12px}
.page-number{position:absolute;right:8px;bottom:7px;z-index:2;padding:3px 7px;border-radius:10px;color:white;background:#26352daa;font-size:10px;pointer-events:none}
.pdf-page.render-error .page-placeholder{color:#a13a35}
</style></head><body>
<div id="loading"><div class="box"><strong>正在载入 PDF 原件</strong><span>大文件将按当前可见页面逐页渲染</span></div></div>
<main id="pages"></main>
<script>
(async()=>{
  const loading=document.getElementById('loading');
  const container=document.getElementById('pages');
  const pageElements=[];
  const nearby=new Set();
  const queued=new Set();
  const rendering=new Set();
  const rendered=new Set();
  const renderQueue=[];
  let pdfDocument=null;
  let observer=null;
  let scrollFrame=0;
  let applyingSync=false;
  let releaseTimer=0;
  let previewZoom=1;

  function placeholder(pageNumber,text){
    const node=document.createElement('span');
    node.className='page-placeholder';
    node.textContent=text||('第 '+pageNumber+' 页');
    return node;
  }

  function badge(pageNumber){
    const node=document.createElement('span');
    node.className='page-number';
    node.textContent=pageNumber;
    return node;
  }

  function currentPage(){
    const point=document.elementFromPoint(
      Math.max(0,Math.min(window.innerWidth-1,window.innerWidth/2)),
      Math.max(0,Math.min(window.innerHeight-1,window.innerHeight*0.38))
    );
    const page=point&&point.closest?point.closest('.pdf-page'):null;
    if(page)return Number(page.dataset.pageNumber)||1;
    const ratio=window.scrollY/Math.max(1,document.documentElement.scrollHeight-window.innerHeight);
    return Math.max(1,Math.min(pdfDocument?pdfDocument.numPages:1,Math.round(ratio*((pdfDocument?pdfDocument.numPages:1)-1))+1));
  }

  function applyPreviewZoom(){
    const pageWidth=Math.max(240,Math.min(window.innerWidth-28,900)*previewZoom);
    for(const element of pageElements)element.style.width=pageWidth+'px';
  }

  function postPosition(kind){
    if(parent===window)return;
    const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    parent.postMessage({
      type:kind==='scroll'?'fxxk_file-preview-scroll':'fxxk_file-preview-ready',
      ratio:maxScroll?window.scrollY/maxScroll:0,
      page:currentPage(),
      pages:pdfDocument?pdfDocument.numPages:1
    },'*');
  }

  function onScroll(){
    if(scrollFrame)return;
    scrollFrame=requestAnimationFrame(()=>{
      scrollFrame=0;
      postPosition(applyingSync?'ready':'scroll');
    });
  }

  function enqueueRender(pageNumber){
    if(rendered.has(pageNumber)||rendering.has(pageNumber)||queued.has(pageNumber))return;
    queued.add(pageNumber);
    renderQueue.push(pageNumber);
    pumpQueue();
  }

  function pumpQueue(){
    while(rendering.size<2&&renderQueue.length){
      const pageNumber=renderQueue.shift();
      queued.delete(pageNumber);
      if(!nearby.has(pageNumber)||rendered.has(pageNumber))continue;
      rendering.add(pageNumber);
      renderPage(pageNumber).finally(()=>{
        rendering.delete(pageNumber);
        pumpQueue();
      });
    }
  }

  function releasePage(pageNumber){
    if(!rendered.has(pageNumber))return;
    const element=pageElements[pageNumber-1];
    const canvas=element.querySelector('canvas');
    if(canvas){
      canvas.width=1;
      canvas.height=1;
    }
    element.classList.remove('render-error');
    element.replaceChildren(placeholder(pageNumber),badge(pageNumber));
    rendered.delete(pageNumber);
  }

  async function renderPage(pageNumber){
    const element=pageElements[pageNumber-1];
    try{
      const page=await pdfDocument.getPage(pageNumber);
      const baseViewport=page.getViewport({scale:1});
      element.style.setProperty('--page-ratio',baseViewport.width+' / '+baseViewport.height);
      await new Promise(resolve=>requestAnimationFrame(resolve));
      const cssWidth=Math.max(1,element.clientWidth);
      const pixelRatio=Math.min(2,Math.max(1,window.devicePixelRatio||1));
      let renderScale=cssWidth/baseViewport.width*pixelRatio;
      const estimatedArea=baseViewport.width*baseViewport.height*renderScale*renderScale;
      if(estimatedArea>12000000)renderScale*=Math.sqrt(12000000/estimatedArea);
      const viewport=page.getViewport({scale:renderScale});
      const canvas=document.createElement('canvas');
      canvas.width=Math.max(1,Math.floor(viewport.width));
      canvas.height=Math.max(1,Math.floor(viewport.height));
      const context=canvas.getContext('2d',{alpha:false});
      await page.render({canvasContext:context,viewport:viewport}).promise;
      page.cleanup();
      if(!nearby.has(pageNumber)){
        canvas.width=1;
        canvas.height=1;
        return;
      }
      element.replaceChildren(canvas,badge(pageNumber));
      rendered.add(pageNumber);
    }catch(error){
      element.classList.add('render-error');
      element.replaceChildren(placeholder(pageNumber,'第 '+pageNumber+' 页渲染失败'),badge(pageNumber));
      rendered.add(pageNumber);
    }
  }

  window.addEventListener('scroll',onScroll,{passive:true});
  window.addEventListener('resize',()=>{
    applyPreviewZoom();
    for(const pageNumber of [...rendered])releasePage(pageNumber);
    for(const pageNumber of nearby)enqueueRender(pageNumber);
    postPosition('ready');
  });
  window.addEventListener('message',event=>{
    const message=event.data;
    if(event.source!==parent||!message)return;
    if(message.type==='fxxk_file-preview-zoom'){
      const maxScrollBefore=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
      const ratio=maxScrollBefore?window.scrollY/maxScrollBefore:0;
      previewZoom=Math.max(.6,Math.min(2,Number(message.zoom)||1));
      applyPreviewZoom();
      for(const pageNumber of [...rendered])releasePage(pageNumber);
      for(const pageNumber of nearby)enqueueRender(pageNumber);
      requestAnimationFrame(()=>{
        const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
        window.scrollTo(0,ratio*maxScroll);
        postPosition('ready');
      });
      return;
    }
    if(message.type!=='fxxk_file-sync-scroll')return;
    const ratio=Math.max(0,Math.min(1,Number(message.ratio)||0));
    const maxScroll=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
    applyingSync=true;
    clearTimeout(releaseTimer);
    window.scrollTo(0,ratio*maxScroll);
    requestAnimationFrame(()=>requestAnimationFrame(()=>postPosition('ready')));
    releaseTimer=setTimeout(()=>{applyingSync=false;},140);
  });

  try{
    if(!window.pdfjsLib)throw new Error('内置 PDF 渲染器未加载');
    window.pdfjsLib.GlobalWorkerOptions.workerSrc='/vendor/pdf.worker.min.js';
    pdfDocument=await window.pdfjsLib.getDocument({
      url:'/api/documents/__DOCUMENT_ID__/preview-pdf',
      cMapUrl:'/vendor/cmaps/',
      cMapPacked:true,
      standardFontDataUrl:'/vendor/standard_fonts/',
      enableXfa:false
    }).promise;
    const firstPage=await pdfDocument.getPage(1);
    const firstViewport=firstPage.getViewport({scale:1});
    firstPage.cleanup();
    const fragment=document.createDocumentFragment();
    for(let pageNumber=1;pageNumber<=pdfDocument.numPages;pageNumber++){
      const element=document.createElement('section');
      element.className='pdf-page';
      element.dataset.pageNumber=String(pageNumber);
      element.style.setProperty('--page-ratio',firstViewport.width+' / '+firstViewport.height);
      element.replaceChildren(placeholder(pageNumber),badge(pageNumber));
      pageElements.push(element);
      fragment.append(element);
    }
    container.append(fragment);
    applyPreviewZoom();
    observer=new IntersectionObserver(entries=>{
      for(const entry of entries){
        const pageNumber=Number(entry.target.dataset.pageNumber);
        if(entry.isIntersecting){
          nearby.add(pageNumber);
          enqueueRender(pageNumber);
        }else{
          nearby.delete(pageNumber);
          releasePage(pageNumber);
        }
      }
    },{root:null,rootMargin:'1200px 0px',threshold:0});
    for(const element of pageElements)observer.observe(element);
    loading.remove();
    requestAnimationFrame(()=>postPosition('ready'));
  }catch(error){
    loading.querySelector('strong').textContent='PDF 原件渲染失败';
    loading.querySelector('span').textContent=error&&error.message?error.message:String(error);
    if(parent!==window)parent.postMessage({
      type:'fxxk_file-preview-error',
      message:'PDF 原件渲染失败'
    },'*');
  }
})();
</script></body></html>""".replace("__DOCUMENT_ID__", document_id)


@app.patch("/api/documents/{document_id}/segments/{segment_id}")
async def update_segment(document_id: str, segment_id: str, body: SegmentUpdate) -> dict:
    document = _load_or_404(document_id)
    segment = next((item for item in document["segments"] if item["id"] == segment_id), None)
    if segment is None:
        raise HTTPException(404, "段落不存在。")
    if body.source is not None:
        segment["source"] = body.source.strip()
    translation_changed = False
    if body.translation is not None:
        translation = body.translation.strip()
        translation_changed = translation != segment.get("translation", "")
        segment["translation"] = translation
        if translation_changed:
            segment["status"] = "edited" if translation else "empty"
    if body.locked is not None:
        segment["locked"] = body.locked
    if body.reviewed is not None:
        segment["status"] = "reviewed" if body.reviewed else ("edited" if segment["translation"] else "empty")
        segment["locked"] = body.reviewed
    _refresh_progress(document)
    save_document(document)
    if translation_changed:
        await asyncio.to_thread(create_translated_docx, document)
    return segment


@app.post("/api/documents/{document_id}/autosave")
async def autosave_document(document_id: str, body: AutosaveRequest) -> dict:
    """Persist visible editor contents, including during desktop-window close."""
    document = _load_or_404(document_id)
    changed = False
    for segment in document.get("segments", []):
        if segment["id"] not in body.translations:
            continue
        value = body.translations[segment["id"]].strip()
        if value != segment.get("translation", ""):
            segment["translation"] = value
            segment["status"] = "edited" if value else "empty"
            changed = True
    if changed:
        _refresh_progress(document)
        save_document(document)
        await asyncio.to_thread(create_translated_docx, document)
    return {"ok": True, "changed": changed}


@app.post("/api/documents/{document_id}/translate", status_code=202)
async def start_translation(document_id: str, body: TranslationRequest) -> dict:
    if body.source_language == body.target_language:
        raise HTTPException(400, "源语言和目标语言不能相同。")
    if not get_settings().translation_configured:
        raise HTTPException(409, "尚未配置翻译模型。请先打开“模型设置”。")
    running = active_tasks.get(document_id)
    if running and not running.done():
        return {"status": "translating", "message": "该文档正在翻译。"}

    document = _load_or_404(document_id)
    document["source_language"] = body.source_language
    document["target_language"] = body.target_language
    document["status"] = "translating"
    document["error"] = ""
    document["retry"] = None
    save_document(document)
    task = asyncio.create_task(_run_translation(document_id, body.overwrite))
    active_tasks[document_id] = task
    task.add_done_callback(lambda _: active_tasks.pop(document_id, None))
    return {"status": "translating", "message": "翻译已开始。"}


@app.post("/api/documents/{document_id}/segments/{segment_id}/translate")
async def translate_one_segment(document_id: str, segment_id: str) -> dict:
    document = _load_or_404(document_id)
    segment = next((item for item in document["segments"] if item["id"] == segment_id), None)
    if segment is None:
        raise HTTPException(404, "段落不存在。")
    if segment.get("locked"):
        raise HTTPException(409, "该段已锁定，请先解锁。")
    try:
        result = await _translate_items(document, [{"id": segment_id, "text": segment["source"]}])
    except TranslationError as exc:
        raise HTTPException(502, str(exc)) from exc
    latest = _load_or_404(document_id)
    latest_segment = next(item for item in latest["segments"] if item["id"] == segment_id)
    # This endpoint is an explicit user request to replace this one segment.
    if not latest_segment.get("locked"):
        latest_segment["translation"] = result[segment_id]
        latest_segment["status"] = "machine"
        _refresh_progress(latest)
        save_document(latest)
    return latest_segment


@app.get("/api/documents/{document_id}/export/{kind}")
async def export_document(document_id: str, kind: Literal["bilingual", "translated"]):
    document = _load_or_404(document_id)
    if kind == "translated":
        path = await asyncio.to_thread(create_translated_docx, document)
    else:
        path, _ = await asyncio.to_thread(create_docx_exports, document)
    return FileResponse(path, filename=path.name)


@app.post("/api/documents/{document_id}/prepare-download")
async def prepare_download(document_id: str) -> dict:
    document = _load_or_404(document_id)
    output_path = await asyncio.to_thread(create_translated_docx, document)
    return {
        "ok": True,
        "output_path": str(output_path.resolve()),
        "download_url": f"/api/documents/{document_id}/export/translated",
    }


async def _run_translation(document_id: str, overwrite: bool) -> None:
    try:
        document = load_document(document_id)
        pending_ids = [
            segment["id"]
            for segment in document["segments"]
            if not segment.get("locked")
            and segment.get("status") not in {"edited", "reviewed"}
            and (overwrite or not segment.get("translation"))
        ]
        if not pending_ids:
            document["status"] = "completed"
            document["retry"] = None
            _refresh_progress(document)
            save_document(document)
            return

        queued = load_document(document_id)
        queued_by_id = {segment["id"]: segment for segment in queued["segments"]}
        for item_id in pending_ids:
            segment = queued_by_id[item_id]
            if not segment.get("locked") and segment.get("status") not in {"edited", "reviewed"}:
                segment["status"] = "queued"
        queued["status"] = "translating"
        queued["retry"] = None
        save_document(queued)

        settings = get_settings()
        batches = _progressive_batches(
            pending_ids,
            queued_by_id,
            settings.batch_size,
            settings.request_char_limit,
        )

        for batch_ids in batches:
            current = load_document(document_id)
            by_id = {segment["id"]: segment for segment in current["segments"]}
            eligible_ids = [
                item_id
                for item_id in batch_ids
                if not by_id[item_id].get("locked")
                and by_id[item_id].get("status") not in {"edited", "reviewed"}
            ]
            if not eligible_ids:
                continue
            for item_id in eligible_ids:
                by_id[item_id]["status"] = "translating"
            current["status"] = "translating"
            current["retry"] = None
            save_document(current)

            items = [{"id": item_id, "text": by_id[item_id]["source"]} for item_id in eligible_ids]
            translated = await _translate_items(current, items)

            latest = load_document(document_id)
            latest_by_id = {segment["id"]: segment for segment in latest["segments"]}
            for item_id, text in translated.items():
                segment = latest_by_id[item_id]
                if segment.get("locked") or segment.get("status") in {"edited", "reviewed"}:
                    continue
                if overwrite or not segment.get("translation"):
                    segment["translation"] = text
                    segment["status"] = "machine"
            latest["status"] = "translating"
            latest["error"] = ""
            latest["retry"] = None
            _refresh_progress(latest)
            save_document(latest)

        completed = load_document(document_id)
        completed["status"] = "completed"
        completed["error"] = ""
        completed["retry"] = None
        for segment in completed["segments"]:
            if segment.get("status") in {"queued", "translating"}:
                segment["status"] = "machine" if segment.get("translation", "").strip() else "empty"
        _refresh_progress(completed)
        save_document(completed)
        await asyncio.to_thread(create_translated_docx, completed)
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        try:
            failed = load_document(document_id)
            failed["status"] = "error"
            failed["error"] = str(exc)
            failed["retry"] = None
            for segment in failed.get("segments", []):
                if segment.get("status") in {"queued", "translating"}:
                    segment["status"] = "machine" if segment.get("translation", "").strip() else "empty"
            save_document(failed)
        except Exception:
            pass


async def _translate_items(document: dict, items: list[dict[str, str]]) -> dict[str, str]:
    document_id = document.get("id")
    source_lang = document["source_language"]
    target_lang = document["target_language"]
    settings = get_settings()
    terms = load_terms(GLOSSARIES, source_lang, target_lang)
    style_guide = load_style_guide(GLOSSARIES)
    expanded: list[dict[str, str]] = []
    part_ids: dict[str, list[str]] = {}
    for item in items:
        chunks = split_into_segments([item["text"]], max_chars=settings.request_char_limit) or [item["text"]]
        ids: list[str] = []
        for index, chunk in enumerate(chunks, 1):
            part_id = item["id"] if len(chunks) == 1 else f"{item['id']}__part{index:04d}"
            expanded.append({"id": part_id, "text": chunk})
            ids.append(part_id)
        part_ids[item["id"]] = ids

    translated_parts: dict[str, str] = {}
    for request_items in _bounded_item_batches(expanded, settings.batch_size, settings.request_char_limit):
        matched = relevant_terms(terms, [item["text"] for item in request_items])
        async def report_retry(notice: dict) -> None:
            if not document_id:
                return
            await _set_retry_state(
                document_id,
                {
                    **notice,
                    "segment_ids": [item["id"].split("__part", 1)[0] for item in request_items],
                },
            )

        try:
            translated_parts.update(
                await translate_batch(
                    request_items,
                    source_lang,
                    target_lang,
                    matched,
                    style_guide,
                    settings,
                    on_retry=report_retry,
                )
            )
        finally:
            if document_id:
                await _set_retry_state(document_id, None)

    joiner = "" if target_lang == "zh" else " "
    return {
        item["id"]: joiner.join(translated_parts[part_id] for part_id in part_ids[item["id"]]).strip()
        for item in items
    }


async def _set_retry_state(document_id: str, retry: dict | None) -> None:
    try:
        latest = load_document(document_id)
    except (FileNotFoundError, OSError, ValueError):
        return
    latest["retry"] = retry
    save_document(latest)


def _progressive_batches(
    pending_ids: list[str],
    by_id: dict[str, dict],
    max_count: int,
    max_chars: int,
) -> list[list[str]]:
    if not pending_ids:
        return []
    batches = [[pending_ids[0]]]
    current: list[str] = []
    char_count = 0
    for item_id in pending_ids[1:]:
        length = len(by_id[item_id].get("source", ""))
        if current and (len(current) >= max_count or char_count + length > max_chars):
            batches.append(current)
            current = []
            char_count = 0
        current.append(item_id)
        char_count += length
    if current:
        batches.append(current)
    return batches


def _bounded_item_batches(items: list[dict[str, str]], max_count: int, max_chars: int) -> list[list[dict[str, str]]]:
    batches: list[list[dict[str, str]]] = []
    current: list[dict[str, str]] = []
    char_count = 0
    for item in items:
        length = len(item["text"])
        if current and (len(current) >= max_count or char_count + length > max_chars):
            batches.append(current)
            current = []
            char_count = 0
        current.append(item)
        char_count += length
    if current:
        batches.append(current)
    return batches


def _refresh_progress(document: dict) -> None:
    segments = document.get("segments", [])
    translated = sum(bool(segment.get("translation", "").strip()) for segment in segments)
    document["progress"] = round(translated * 100 / len(segments)) if segments else 0


def _load_or_404(document_id: str) -> dict:
    try:
        return load_document(document_id)
    except (FileNotFoundError, OSError, ValueError):
        raise HTTPException(404, "文档不存在。")


app.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
