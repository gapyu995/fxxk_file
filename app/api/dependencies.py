"""Reusable API dependencies and document lookup helpers."""
from __future__ import annotations

from fastapi import HTTPException

from app.services.storage import load_document


def load_or_404(document_id: str) -> dict:
    try:
        return load_document(document_id)
    except (FileNotFoundError, OSError, ValueError) as exc:
        raise HTTPException(404, "文档不存在。") from exc
