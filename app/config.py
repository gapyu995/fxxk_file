from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from dotenv import dotenv_values, load_dotenv


ROOT = Path(__file__).resolve().parents[1]
ENV_FILE = ROOT / ".env"


@dataclass(frozen=True)
class Settings:
    api_key: str
    base_url: str
    model: str
    protocol: str
    use_system_proxy: bool
    batch_size: int
    request_char_limit: int
    max_retries: int
    host: str
    port: int

    @property
    def translation_configured(self) -> bool:
        # A local CCSwitch gateway may not require authentication.
        return bool(self.base_url and self.model and self.protocol in {"openai", "anthropic"})


def get_settings() -> Settings:
    # Reload so settings saved from the browser take effect without a restart.
    load_dotenv(ENV_FILE, override=True)
    return Settings(
        api_key=os.getenv("TRANSLATION_API_KEY", "").strip(),
        base_url=os.getenv("TRANSLATION_BASE_URL", "https://api.openai.com/v1").strip().rstrip("/"),
        model=os.getenv("TRANSLATION_MODEL", "gpt-4.1-mini").strip(),
        protocol=os.getenv("TRANSLATION_PROTOCOL", "openai").strip().lower(),
        use_system_proxy=os.getenv("TRANSLATION_USE_SYSTEM_PROXY", "false").strip().lower() in {"1", "true", "yes", "on"},
        batch_size=max(1, min(10, int(os.getenv("TRANSLATION_BATCH_SIZE", "3")))),
        request_char_limit=max(500, min(20000, int(os.getenv("TRANSLATION_REQUEST_CHAR_LIMIT", "6000")))),
        max_retries=max(0, min(10, int(os.getenv("TRANSLATION_MAX_RETRIES", "5")))),
        host=os.getenv("APP_HOST", "127.0.0.1").strip(),
        port=int(os.getenv("APP_PORT", "8765")),
    )


def save_translation_settings(
    api_key: str,
    base_url: str,
    model: str,
    protocol: str,
    use_system_proxy: bool,
    batch_size: int,
    request_char_limit: int,
    max_retries: int,
) -> None:
    current = dict(dotenv_values(ENV_FILE)) if ENV_FILE.exists() else {}
    current.update(
        {
            "TRANSLATION_API_KEY": api_key.strip(),
            "TRANSLATION_BASE_URL": base_url.strip().rstrip("/"),
            "TRANSLATION_MODEL": model.strip(),
            "TRANSLATION_PROTOCOL": protocol.strip().lower(),
            "TRANSLATION_USE_SYSTEM_PROXY": "true" if use_system_proxy else "false",
            "TRANSLATION_BATCH_SIZE": str(max(1, min(10, batch_size))),
            "TRANSLATION_REQUEST_CHAR_LIMIT": str(max(500, min(20000, request_char_limit))),
            "TRANSLATION_MAX_RETRIES": str(max(0, min(10, max_retries))),
            "APP_HOST": current.get("APP_HOST") or "127.0.0.1",
            "APP_PORT": current.get("APP_PORT") or "8765",
        }
    )
    lines = [f"{key}={_quote_env(str(value))}" for key, value in current.items() if value is not None]
    ENV_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def _quote_env(value: str) -> str:
    if not value or any(ch.isspace() or ch in "#'\"" for ch in value):
        return '"' + value.replace("\\", "\\\\").replace('"', '\\"') + '"'
    return value
