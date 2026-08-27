"""Document lifecycle, upload, preview and export endpoints."""

from __future__ import annotations

import asyncio
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, HTMLResponse

from app.api.dependencies import load_or_404
from app.core.runtime import MAX_UPLOAD_BYTES, active_tasks
from app.services.extractor import ExtractionError, SUPPORTED_EXTENSIONS, extract_paragraphs
from app.services.segmenter import detect_language, split_into_segments
from app.services.storage import (
    ORIGINALS,
    archive_document_record,
    create_docx_exports,
    create_original_preview,
    create_translated_docx,
    list_documents,
    safe_filename,
    save_document,
    utc_now,
)
from app.services.preview import _docx_preview_page, _pdf_preview_page

router = APIRouter()


@router.get("/api/documents")
async def documents() -> list[dict]:
    return list_documents()


@router.post("/api/documents")
async def upload_document(
    file: UploadFile = File(...),
    source_language: str = Form("auto"),
    target_language: str = Form("auto"),
) -> dict:
    original_name = safe_filename(file.filename or "document")
    suffix = Path(original_name).suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        supported = ", ".join(sorted(SUPPORTED_EXTENSIONS))
        raise HTTPException(415, f"不支持该格式。可上传：{supported}")

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


@router.get("/api/documents/{document_id}")
async def get_document(document_id: str) -> dict:
    return load_or_404(document_id)


@router.delete("/api/documents/{document_id}")
async def delete_document_record(document_id: str) -> dict:
    document = load_or_404(document_id)
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

@router.get("/api/documents/{document_id}/original")
async def get_original(document_id: str):
    document = load_or_404(document_id)
    path = (ORIGINALS.parent / document["original_path"]).resolve()
    try:
        path.relative_to(ORIGINALS.resolve())
    except ValueError as exc:
        raise HTTPException(400, "原文件路径无效。") from exc
    if not path.is_file():
        raise HTTPException(404, "原文件不存在。")
    return FileResponse(path, filename=document["name"])


@router.get("/api/documents/{document_id}/preview")
async def preview_original(document_id: str):
    document = load_or_404(document_id)
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


@router.get("/api/documents/{document_id}/preview-pdf")
async def preview_pdf_file(document_id: str):
    document = load_or_404(document_id)
    path = await asyncio.to_thread(create_original_preview, document)
    if not path or not path.is_file():
        raise HTTPException(404, "无法生成 PDF 分页预览。")
    return FileResponse(path, media_type="application/pdf", headers={"Cache-Control": "no-store"})


@router.get("/api/documents/{document_id}/export/{kind}")
async def export_document(document_id: str, kind: Literal["bilingual", "translated"]):
    document = load_or_404(document_id)
    if kind == "translated":
        path = await asyncio.to_thread(create_translated_docx, document)
    else:
        path, _ = await asyncio.to_thread(create_docx_exports, document)
    return FileResponse(path, filename=path.name)


@router.post("/api/documents/{document_id}/prepare-download")
async def prepare_download(document_id: str) -> dict:
    document = load_or_404(document_id)
    output_path = await asyncio.to_thread(create_translated_docx, document)
    return {
        "ok": True,
        "output_path": str(output_path.resolve()),
        "download_url": f"/api/documents/{document_id}/export/translated",
    }
