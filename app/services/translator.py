from __future__ import annotations

import asyncio
import json
import random
import re
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx

from app.config import Settings
from app.services.glossary import Term


LANGUAGE_NAMES = {"zh": "Simplified Chinese", "en": "English"}


class TranslationError(RuntimeError):
    pass


class _RetryableTranslationError(TranslationError):
    def __init__(self, message: str, retry_after: float | None = None):
        super().__init__(message)
        self.retry_after = retry_after


class _PermanentTranslationError(TranslationError):
    pass


RetryCallback = Callable[[dict[str, Any]], Awaitable[None]]


async def translate_batch(
    items: list[dict[str, str]],
    source_lang: str,
    target_lang: str,
    terms: list[Term],
    style_guide: str,
    settings: Settings,
    on_retry: RetryCallback | None = None,
) -> dict[str, str]:
    if not settings.translation_configured:
        raise TranslationError("尚未配置翻译模型。请点击右上角“模型设置”。")

    system_prompt = _system_prompt(source_lang, target_lang, terms, style_guide)
    endpoint = build_endpoint(settings.base_url, settings.protocol)
    payload, headers = _build_request(settings, system_prompt, items)
    last_error = ""
    max_retries = max(0, int(getattr(settings, "max_retries", 5)))
    for attempt in range(max_retries + 1):
        try:
            async with httpx.AsyncClient(
                timeout=httpx.Timeout(120.0, connect=20.0),
                trust_env=settings.use_system_proxy,
            ) as client:
                response = await client.post(endpoint, headers=headers, json=payload)
            if response.status_code >= 400:
                detail = response.text[:800].strip()
                message = f"模型接口返回 HTTP {response.status_code}" + (f"：{detail}" if detail else "")
                if _is_retryable_status(response.status_code):
                    raise _RetryableTranslationError(message, _retry_after_seconds(response))
                raise _PermanentTranslationError(message)
            content = _response_text(response.json(), settings.protocol)
            parsed = _parse_response(content)
            expected = {item["id"] for item in items}
            if not expected.issubset(parsed):
                missing = ", ".join(sorted(expected - parsed))
                raise TranslationError(f"模型响应缺少段落：{missing}")
            return {key: parsed[key] for key in expected}
        except asyncio.CancelledError:
            raise
        except _PermanentTranslationError as exc:
            raise TranslationError(str(exc)) from exc
        except (httpx.HTTPError, KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError, TranslationError) as exc:
            if isinstance(exc, httpx.ProxyError):
                raise TranslationError(
                    f"系统代理连接网关失败：{exc}。请在模型设置中关闭“使用系统代理”。"
                ) from exc
            if isinstance(exc, httpx.TimeoutException):
                last_error = f"模型请求超时：{exc or '等待响应超过时限'}"
            elif isinstance(exc, httpx.ConnectError):
                last_error = f"无法连接模型网关：{exc}"
            else:
                last_error = str(exc)
            if attempt >= max_retries:
                break
            retry_number = attempt + 1
            retry_after = exc.retry_after if isinstance(exc, _RetryableTranslationError) else None
            delay = _retry_delay_seconds(retry_number, retry_after)
            if on_retry:
                try:
                    await on_retry(
                        {
                            "retry_number": retry_number,
                            "max_retries": max_retries,
                            "delay_seconds": round(delay, 1),
                            "reason": last_error[:500],
                        }
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:
                    pass
            await asyncio.sleep(delay)
    raise TranslationError(last_error or "翻译请求失败。")


def _is_retryable_status(status_code: int) -> bool:
    return status_code in {408, 409, 425, 429} or 500 <= status_code <= 599


def _retry_after_seconds(response: httpx.Response) -> float | None:
    value = response.headers.get("Retry-After", "").strip()
    if not value:
        return None
    try:
        return max(0.0, min(120.0, float(value)))
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
            if retry_at.tzinfo is None:
                retry_at = retry_at.replace(tzinfo=timezone.utc)
            return max(0.0, min(120.0, (retry_at - datetime.now(timezone.utc)).total_seconds()))
        except (TypeError, ValueError, OverflowError):
            return None


def _retry_delay_seconds(retry_number: int, retry_after: float | None = None) -> float:
    exponential = min(30.0, 2.0 * (2 ** max(0, retry_number - 1)))
    delay = exponential + random.uniform(0.0, exponential * 0.2)
    if retry_after is not None:
        delay = max(delay, retry_after)
    return min(120.0, delay)


def build_endpoint(base_url: str, protocol: str) -> str:
    """Accept either a CCSwitch gateway base URL or a complete endpoint URL."""
    base = base_url.strip().rstrip("/")
    lowered = base.lower()
    if protocol == "anthropic":
        if lowered.endswith("/messages"):
            return base
        if lowered.endswith("/v1"):
            return base + "/messages"
        return base + "/v1/messages"
    if lowered.endswith("/chat/completions"):
        return base
    if lowered.endswith("/v1"):
        return base + "/chat/completions"
    return base + "/v1/chat/completions"


def _build_request(settings: Settings, system_prompt: str, items: list[dict[str, str]]) -> tuple[dict, dict]:
    user_content = json.dumps({"segments": items}, ensure_ascii=False)
    headers = {"Content-Type": "application/json"}
    if settings.protocol == "anthropic":
        if settings.api_key:
            headers["x-api-key"] = settings.api_key
        headers["anthropic-version"] = "2023-06-01"
        payload = {
            "model": settings.model,
            "max_tokens": 8192,
            "temperature": 0.2,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_content}],
        }
    else:
        if settings.api_key:
            headers["Authorization"] = f"Bearer {settings.api_key}"
        payload = {
            "model": settings.model,
            "temperature": 0.2,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_content},
            ],
        }
    return payload, headers


def _response_text(data: dict, protocol: str) -> str:
    if protocol == "anthropic":
        content = data["content"]
        if not isinstance(content, list):
            raise TranslationError("Anthropic 网关返回的 content 结构不正确。")
        return "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict) and part.get("type") == "text")
    content = data["choices"][0]["message"]["content"]
    if isinstance(content, list):
        return "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
    return str(content)


def _system_prompt(source_lang: str, target_lang: str, terms: list[Term], style_guide: str) -> str:
    source = LANGUAGE_NAMES.get(source_lang, source_lang)
    target = LANGUAGE_NAMES.get(target_lang, target_lang)
    term_lines = []
    for term in terms:
        extras = "; ".join(part for part in (term.domain, term.notes) if part)
        term_lines.append(f"- {term.source} => {term.target}" + (f" ({extras})" if extras else ""))
    terminology = "\n".join(term_lines) if term_lines else "(No matching mandatory terms.)"
    style = style_guide or "Use a professional, clear register appropriate to the source document."
    return f"""You are a senior professional translator. Translate from {source} to {target}.

Rules:
1. Preserve meaning, numbers, units, names, headings, list markers, and inline formatting.
2. Use the mandatory terminology exactly and consistently when context permits.
3. Do not add explanations, commentary, quotation marks, or omitted-content markers.
4. Translate each segment independently but keep wording consistent across the batch.
5. Return only a JSON object in this exact shape:
{{"translations":[{{"id":"segment id","text":"translated text"}}]}}

Mandatory terminology:
{terminology}

Style guide:
{style}
"""


def _parse_response(content: Any) -> dict[str, str]:
    if not isinstance(content, str):
        raise TranslationError("模型返回了无法识别的内容。")
    cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", content.strip(), flags=re.IGNORECASE)
    data = json.loads(cleaned)
    rows = data.get("translations", data if isinstance(data, list) else [])
    if not isinstance(rows, list):
        raise TranslationError("模型返回的 JSON 结构不正确。")
    result: dict[str, str] = {}
    for row in rows:
        if isinstance(row, dict) and "id" in row and "text" in row:
            result[str(row["id"])] = str(row["text"]).strip()
    return result
