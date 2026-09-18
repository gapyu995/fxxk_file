"""File-conversion endpoints.

Every tool takes uploaded bytes plus a small JSON/form parameter set and returns
the converted payload. Conversions that produce a single file stream it back
with a download disposition; multi-output tools (subtitle split, PDF split)
return a small JSON manifest instead so the front end can offer each file
separately.
"""

from __future__ import annotations

import asyncio
import io
import json
import uuid
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from app.core.runtime import MAX_UPLOAD_BYTES
from app.services.converters import (
    available_converters,
    documents,
    language,
    pdf_pages,
    subtitles,
    tables,
    text,
)
from app.services.storage import OUTPUT, safe_filename, utc_now

router = APIRouter()

CONVERT_OUTPUT = OUTPUT / "converted"

# Uploads larger than this are refused before being read into memory: the
# conversion tools hold whole files in RAM, unlike the streaming translation
# upload path.
MAX_CONVERT_BYTES = 40 * 1024 * 1024

IMAGE_EXTENSIONS = (".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp")


@router.get("/api/convert/capabilities")
async def capabilities() -> dict:
    return {"groups": available_converters()}


@router.post("/api/convert/text")
async def convert_text_endpoint(
    content: str = Form(""),
    mode: str = Form(...),
    file: UploadFile | None = File(None),
) -> Response:
    """Typography conversions: width, punctuation, or decoding a legacy file."""
    text_value = content
    source_encoding = ""
    if file is not None and file.filename:
        data = await _read_upload(file)
        try:
            decoded = text.transcode(data)
        except text.TextConversionError as exc:
            raise HTTPException(422, str(exc)) from exc
        text_value = decoded["text"]
        source_encoding = decoded["source_encoding"]
    if not text_value:
        raise HTTPException(422, "请提供要转换的文本或文件。")
    if mode == "transcode":
        if not source_encoding:
            source_encoding = text.detect_encoding(text_value.encode("utf-8"))
        return _json({"text": text_value, "source_encoding": source_encoding, "changed": 0})
    try:
        converted = text.apply_mode(text_value, mode)
    except text.TextConversionError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _json({"text": converted, "source_encoding": source_encoding, "changed": _diff_count(text_value, converted)})


@router.post("/api/convert/tables")
async def convert_tables_endpoint(
    data: str = Form(...),
    source: str = Form(""),
    target: str = Form(...),
) -> Response:
    origin = source.strip() or tables.sniff_format(data)
    try:
        converted = tables.convert(data, origin, target)
    except tables.TableError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _json({"text": converted, "source": origin, "target": target})


@router.post("/api/convert/documents/{mode}")
async def convert_document_endpoint(
    mode: Literal["html_to_markdown", "docx_to_markdown", "markdown_to_docx"],
    content: str = Form(""),
    file: UploadFile | None = File(None),
) -> Response:
    if mode == "html_to_markdown":
        body = content
        if file is not None and file.filename:
            body = (await _read_upload(file)).decode("utf-8", errors="replace")
        try:
            return _json({"text": documents.html_to_markdown(body)})
        except documents.DocumentConversionError as exc:
            raise HTTPException(422, str(exc)) from exc
    if mode == "docx_to_markdown":
        if file is None or not file.filename:
            raise HTTPException(422, "请上传 DOCX 文件。")
        try:
            return _json({"text": documents.docx_to_markdown(await _read_upload(file))})
        except documents.DocumentConversionError as exc:
            raise HTTPException(422, str(exc)) from exc
    if not content.strip():
        raise HTTPException(422, "请填写 Markdown 内容。")
    data = await asyncio.to_thread(documents.markdown_to_docx, content)
    return _download(data, "converted.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")


@router.post("/api/convert/subtitles/convert")
async def convert_subtitles_endpoint(
    target: str = Form(".srt"),
    file: UploadFile = File(...),
) -> Response:
    data = await _read_upload(file)
    try:
        converted = await asyncio.to_thread(subtitles.convert, data, target)
    except subtitles.SubtitleError as exc:
        raise HTTPException(422, str(exc)) from exc
    name = f"{Path(safe_filename(file.filename or 'subtitle')).stem}{_extension(target)}"
    return _json({"text": converted, "filename": name, "info": subtitles.info(data)})


@router.post("/api/convert/subtitles/merge")
async def merge_subtitles_endpoint(
    first: UploadFile = File(...),
    second: UploadFile = File(...),
    separator: str = Form("\n"),
) -> Response:
    left = await _read_upload(first)
    right = await _read_upload(second)
    try:
        merged = await asyncio.to_thread(subtitles.merge, left, right, separator)
    except subtitles.SubtitleError as exc:
        raise HTTPException(422, str(exc)) from exc
    return _json({"text": merged, "filename": "merged.srt", "info": subtitles.info(merged)})


@router.post("/api/convert/subtitles/split")
async def split_subtitles_endpoint(file: UploadFile = File(...)) -> Response:
    data = await _read_upload(file)
    try:
        tracks = await asyncio.to_thread(subtitles.split, data)
    except subtitles.SubtitleError as exc:
        raise HTTPException(422, str(exc)) from exc
    stem = Path(safe_filename(file.filename or "subtitle")).stem
    return _json({
        "files": [
            {"filename": f"{stem}.track{index + 1}.srt", "text": track}
            for index, track in enumerate(tracks)
        ]
    })


@router.post("/api/convert/pdf/{mode}")
async def convert_pdf_endpoint(
    mode: Literal["merge", "split", "extract", "delete", "rotate", "watermark"],
    files: list[UploadFile] = File(default=[]),
    pages: str = Form("all"),
    degrees: int = Form(90),
    text_value: str = Form("", alias="watermark_text"),
    opacity: float = Form(0.25),
) -> Response:
    payloads = [await _read_upload(item) for item in files if item.filename]
    if not payloads:
        raise HTTPException(422, "请上传至少一份 PDF。")
    try:
        if mode == "merge":
            data = await asyncio.to_thread(pdf_pages.merge, payloads)
            return _download(data, "merged.pdf", "application/pdf")
        if mode == "split":
            parts = await asyncio.to_thread(pdf_pages.split, payloads[0])
            return _json({
                "count": len(parts),
                "files": [{"filename": f"page-{index + 1:03d}.pdf", "size": len(part)} for index, part in enumerate(parts)],
                "download_url": await _store_split_parts(parts),
            })
        if mode == "extract":
            data = await asyncio.to_thread(pdf_pages.extract, payloads[0], pages)
            return _download(data, "extracted.pdf", "application/pdf")
        if mode == "delete":
            data = await asyncio.to_thread(pdf_pages.delete, payloads[0], pages)
            return _download(data, "pages-removed.pdf", "application/pdf")
        if mode == "rotate":
            data = await asyncio.to_thread(pdf_pages.rotate, payloads[0], degrees, pages)
            return _download(data, "rotated.pdf", "application/pdf")
        data = await asyncio.to_thread(pdf_pages.watermark, payloads[0], text_value, opacity)
        return _download(data, "watermarked.pdf", "application/pdf")
    except pdf_pages.PdfError as exc:
        raise HTTPException(422, str(exc)) from exc


@router.get("/api/convert/output/{token}")
async def download_conversion(token: str) -> FileResponse:
    """Serve a multi-file conversion bundle produced earlier in this session."""
    if not token.isalnum() or len(token) != 12:
        raise HTTPException(400, "无效的转换标识。")
    path = CONVERT_OUTPUT / f"{token}.zip"
    if not path.is_file():
        raise HTTPException(404, "转换结果不存在或已被清理。")
    return FileResponse(path, filename=path.name, media_type="application/zip")


@router.post("/api/convert/language")
async def convert_language_endpoint(
    mode: Literal["upper_amount", "chinese_number", "pinyin"] = Form(...),
    value: str = Form(...),
    style: str = Form("plain"),
) -> Response:
    try:
        if mode == "upper_amount":
            return _json({"text": language.to_upper_amount(value), "mode": mode})
        if mode == "chinese_number":
            try:
                number = int(str(value).strip())
            except ValueError as exc:
                raise HTTPException(422, "中文数字转换只接受整数。") from exc
            return _json({"text": language.to_chinese_number(number), "mode": mode})
        return _json({"text": language.to_pinyin(value, style), "mode": mode})
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except language.LanguageConversionError as exc:
        raise HTTPException(422, str(exc)) from exc


async def _read_upload(file: UploadFile) -> bytes:
    data = await file.read()
    await file.close()
    if len(data) > min(MAX_CONVERT_BYTES, MAX_UPLOAD_BYTES):
        raise HTTPException(413, "文件超过转换工具的 40 MB 限制。")
    return data


async def _store_split_parts(parts: list[bytes]) -> str:
    """Zip split pages to disk and return a download URL for the bundle."""

    def build() -> str:
        CONVERT_OUTPUT.mkdir(parents=True, exist_ok=True)
        token = uuid.uuid4().hex[:12]
        target = CONVERT_OUTPUT / f"{token}.zip"
        with zipfile.ZipFile(target, "w", zipfile.ZIP_DEFLATED) as archive:
            for index, part in enumerate(parts, 1):
                archive.writestr(f"page-{index:03d}.pdf", part)
        return f"/api/convert/output/{token}"

    return await asyncio.to_thread(build)


def _extension(value: str) -> str:
    candidate = str(value or "").strip().lower()
    return candidate if candidate.startswith(".") else f".{candidate}"


def _diff_count(before: str, after: str) -> int:
    return sum(1 for left, right in zip(before, after) if left != right) + abs(len(before) - len(after))


def _json(payload: dict) -> JSONResponse:
    return JSONResponse(content=json.loads(json.dumps(payload, ensure_ascii=False)))


def _download(data: bytes | str, filename: str, media_type: str) -> Response:
    body = data.encode("utf-8") if isinstance(data, str) else data
    headers = {"Content-Disposition": f'attachment; filename="{filename}"'}
    return Response(content=body, media_type=media_type, headers=headers)
