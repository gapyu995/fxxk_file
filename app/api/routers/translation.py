"""Segment editing and translation task endpoints."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app.api.dependencies import load_or_404
from app.api.schemas import (
    AutosaveRequest,
    ConvertScriptRequest,
    SegmentBatchRequest,
    SegmentUpdate,
    TranslationRequest,
)
from app.core.runtime import active_tasks
from app.config import get_settings
from app.services.segment_batch import normalize_action, run_batch
from app.services.storage import create_translated_docx, save_document
from app.services.text_normalize import effective_mode, normalize_mode, normalize_translation
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
    if body.zh_script_mode is not None:
        document["zh_script_mode"] = normalize_mode(body.zh_script_mode)
    save_document(document)
    task = asyncio.create_task(_run_translation(document_id, body.overwrite))
    active_tasks[document_id] = task
    task.add_done_callback(lambda _: active_tasks.pop(document_id, None))
    return {"status": "translating", "message": "翻译已开始。"}


@router.post("/api/documents/{document_id}/convert-script")
async def convert_document_script(document_id: str, body: ConvertScriptRequest) -> dict:
    """Re-write every Chinese translation in the requested script, locally.

    This is the manual counterpart to the automatic conversion applied after a
    batch: it lets a finished document be switched between Simplified and
    Traditional Chinese without spending model quota. Reviewed paragraphs are
    converted too, because the user explicitly asked for the whole document, and
    their status is reset to ``edited`` so the change is visible.
    """
    document = load_or_404(document_id)
    target_lang = document.get("target_language", "zh")
    resolved = effective_mode(body.mode, target_lang if target_lang == "zh" else "zh")
    changed = 0
    for segment in document.get("segments", []):
        current = segment.get("translation", "")
        if not current or not any("\u3400" <= char <= "\u9fff" for char in current):
            continue
        converted = normalize_translation(current, "zh", resolved)
        if converted != current:
            segment["translation"] = converted
            if segment.get("status") == "reviewed":
                segment["status"] = "edited"
            changed += 1
    document["zh_script_mode"] = normalize_mode(body.mode)
    if changed:
        _refresh_progress(document)
        save_document(document)
        await asyncio.to_thread(create_translated_docx, document)
    return {"ok": True, "changed": changed, "mode": document["zh_script_mode"], "document": document}


@router.post("/api/documents/{document_id}/segments/batch")
async def batch_segments(document_id: str, body: SegmentBatchRequest) -> dict:
    """Apply one bulk action to every paragraph a filter selects.

    Selection deliberately works from the persisted document rather than the
    browser's view: the UI may only be rendering part of a long document, and a
    bulk action must never depend on what happens to be on screen.
    """
    document = load_or_404(document_id)
    result = run_batch(document.get("segments", []), body.filter, normalize_action(body.action))
    if result.changed:
        _refresh_progress(document)
        save_document(document)
        if body.action == "clear":
            await asyncio.to_thread(create_translated_docx, document)
    return {
        "ok": True,
        "matched": result.matched,
        "changed": result.changed,
        "filter": body.filter,
        "action": body.action,
        "document": document,
    }


@router.post("/api/documents/{document_id}/cancel")
async def cancel_translation(document_id: str) -> dict:
    """Stop the running translation task for one document.

    The background job already persists every finished batch, so cancelling only
    ends the loop: translated segments stay, queued ones fall back to empty, and
    the document returns to a state where the user can edit or resume.
    """
    load_or_404(document_id)
    task = active_tasks.get(document_id)
    if task is None or task.done():
        document = load_or_404(document_id)
        # A run that was interrupted by a restart can leave paragraphs marked
        # queued/translating with no task behind them; stopping is the moment to
        # put the document back into an editable state.
        if _release_stalled_segments(document):
            _refresh_progress(document)
            save_document(document)
        return {"ok": True, "status": "idle", "message": "当前没有正在进行的翻译。", "document": document}
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        pass
    except Exception:
        # A failure during shutdown must not mask the user's stop request.
        pass
    active_tasks.pop(document_id, None)
    document = load_or_404(document_id)
    _release_stalled_segments(document)
    document["status"] = "ready"
    document["retry"] = None
    document["error"] = ""
    _refresh_progress(document)
    save_document(document)
    return {"ok": True, "status": "cancelled", "message": "已停止翻译，已完成的段落会保留。", "document": document}


def _release_stalled_segments(document: dict) -> bool:
    """Return paragraphs stuck in a running state to a stable one."""
    changed = False
    for segment in document.get("segments", []):
        if segment.get("status") in {"queued", "translating"}:
            segment["status"] = "machine" if segment.get("translation", "").strip() else "empty"
            changed = True
    return changed


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
