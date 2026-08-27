"""Background translation orchestration and batching helpers."""

from __future__ import annotations

import asyncio

from app.config import get_settings
from app.services.glossary import load_style_guide, load_terms, relevant_terms
from app.services.segmenter import split_into_segments
from app.services.storage import GLOSSARIES, create_translated_docx, load_document, save_document
from app.services.translator import translate_batch


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
