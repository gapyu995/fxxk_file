"""HTML preview documents for DOCX and PDF originals."""

from __future__ import annotations

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
