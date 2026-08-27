"""Segment editing and translation task endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.api.dependencies import load_or_404
from app.api.schemas import AutosaveRequest, SegmentUpdate, TranslationRequest
from app.core.runtime import active_tasks
from app.config import get_settings
from app.services.storage import create_translated_docx, save_document
from app.services.translation_job import _refresh_progress, _run_translation, _translate_items
from app.services.translator import TranslationError

router = APIRouter()


@router.patch("/api/documents/{document_id}/segments/{segment_id}")
async def update_segment(document_id: str, segment_id: str, body: SegmentUpdate) -> dict:
    document = load_or_404(document_id)
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


@router.post("/api/documents/{document_id}/autosave")
async def autosave_document(document_id: str, body: AutosaveRequest) -> dict:
    """Persist visible editor contents, including during desktop-window close."""
    document = load_or_404(document_id)
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


@router.post("/api/documents/{document_id}/translate", status_code=202)
async def start_translation(document_id: str, body: TranslationRequest) -> dict:
    if body.source_language == body.target_language:
        raise HTTPException(400, "源语言和目标语言不能相同。")
    if not get_settings().translation_configured:
        raise HTTPException(409, "尚未配置翻译模型。请先打开“模型设置”。")
    running = active_tasks.get(document_id)
    if running and not running.done():
        return {"status": "translating", "message": "该文档正在翻译。"}

    document = load_or_404(document_id)
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


@router.post("/api/documents/{document_id}/segments/{segment_id}/translate")
async def translate_one_segment(document_id: str, segment_id: str) -> dict:
    document = load_or_404(document_id)
    segment = next((item for item in document["segments"] if item["id"] == segment_id), None)
    if segment is None:
        raise HTTPException(404, "段落不存在。")
    if segment.get("locked"):
        raise HTTPException(409, "该段已锁定，请先解锁。")
    try:
        result = await _translate_items(document, [{"id": segment_id, "text": segment["source"]}])
    except TranslationError as exc:
        raise HTTPException(502, str(exc)) from exc
    latest = load_or_404(document_id)
    latest_segment = next(item for item in latest["segments"] if item["id"] == segment_id)
    # This endpoint is an explicit user request to replace this one segment.
    if not latest_segment.get("locked"):
        latest_segment["translation"] = result[segment_id]
        latest_segment["status"] = "machine"
        _refresh_progress(latest)
        save_document(latest)
    return latest_segment
