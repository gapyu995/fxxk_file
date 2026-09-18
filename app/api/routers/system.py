"""System and translation-settings endpoints."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.api.schemas import SettingsUpdate
from app.config import get_settings, save_translation_settings
from app.services.ocr import available as ocr_available
from app.services.pdf_layout import available as pdf_layout_available
from app.services.storage import STATIC
from app.services.text_normalize import available as zhconv_available

router = APIRouter()


@router.get("/", include_in_schema=False)
async def web_index():
    return FileResponse(
        STATIC / "index.html",
        headers={"Cache-Control": "no-store, no-cache, must-revalidate"},
    )


@router.get("/api/health")
async def health() -> dict:
    return {"ok": True, "translation_configured": get_settings().translation_configured}


@router.get("/api/settings")
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
        "zh_script_mode": settings.zh_script_mode,
        "zh_script_available": zhconv_available(),
        "ocr_available": ocr_available(),
        "pdf_layout_available": pdf_layout_available(),
    }


@router.put("/api/settings")
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
        body.zh_script_mode,
    )
    updated = get_settings()
    return {"configured": updated.translation_configured, "has_api_key": bool(updated.api_key)}
