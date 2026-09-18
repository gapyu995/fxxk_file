"""Batch segment operations: filter-driven lock/review/reset across a document.

The workbench historically edited one paragraph at a time. A 1,500-segment
document needs a way to act on a filtered set, so this module owns the pure
selection logic and the router stays a thin HTTP wrapper over it.
"""

from __future__ import annotations

from dataclasses import dataclass

FILTER_VALUES = (
    "all",
    "empty",
    "machine",
    "edited",
    "reviewed",
    "locked",
    "untranslated",
)

ACTION_VALUES = ("lock", "unlock", "review", "unreview", "clear")


@dataclass(frozen=True)
class BatchResult:
    matched: int
    changed: int


def normalize_filter(value: str | None) -> str:
    candidate = (value or "all").strip().lower()
    return candidate if candidate in FILTER_VALUES else "all"


def normalize_action(value: str | None) -> str:
    candidate = (value or "").strip().lower()
    if candidate not in ACTION_VALUES:
        raise ValueError(f"不支持的操作：{value}")
    return candidate


def matches_filter(segment: dict, mode: str) -> bool:
    """Return whether one segment belongs to the requested review bucket.

    ``untranslated`` is the union users actually think in: anything with no
    translation text, including paragraphs the last run left queued.
    """
    translation = str(segment.get("translation", "")).strip()
    status = str(segment.get("status", "empty"))
    locked = bool(segment.get("locked"))
    if mode == "all":
        return True
    if mode == "locked":
        return locked
    if mode == "untranslated":
        return not translation or status in {"empty", "queued"}
    if mode == "reviewed":
        return status == "reviewed"
    if mode == "edited":
        return status == "edited"
    if mode == "machine":
        return status == "machine"
    if mode == "empty":
        return not translation
    return True


def apply_action(segment: dict, action: str) -> bool:
    """Apply one batch action in place; return whether the segment changed.

    Locked paragraphs are intentionally immune to ``review``/``clear``: the lock
    is the user's promise that a paragraph is settled, and a bulk action must not
    silently break it. ``unlock`` is the one action that targets them.
    """
    translation = str(segment.get("translation", "")).strip()
    locked = bool(segment.get("locked"))
    status = str(segment.get("status", "empty"))
    if action == "lock":
        if locked:
            return False
        segment["locked"] = True
        return True
    if action == "unlock":
        if not locked:
            return False
        segment["locked"] = False
        return True
    if action == "unreview":
        # Reviewing locks the paragraph, so undoing a review must unlock it;
        # otherwise this is the one action that could never reach its target.
        if status != "reviewed":
            return False
        segment["status"] = "edited" if translation else "empty"
        segment["locked"] = False
        return True
    if locked:
        return False
    if action == "review":
        if not translation or status == "reviewed":
            return False
        segment["status"] = "reviewed"
        segment["locked"] = True
        return True
    if action == "clear":
        if not translation:
            return False
        segment["translation"] = ""
        segment["status"] = "empty"
        return True
    return False


def run_batch(segments: list[dict], mode: str, action: str) -> BatchResult:
    selected = [segment for segment in segments if matches_filter(segment, mode)]
    changed = sum(1 for segment in selected if apply_action(segment, action))
    return BatchResult(matched=len(selected), changed=changed)
