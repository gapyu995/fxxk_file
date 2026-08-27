"""Pydantic request schemas used by the HTTP API."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


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
