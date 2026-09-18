"""Conversion toolkit registry.

Every group reports its own availability so `/api/convert/capabilities` can tell
the UI which tools work right now and which need an extra install. The
dependency-free groups (text, tables, numbers, Markdown/DOCX writing) are always
available; the rest degrade to a clear message instead of an import error.
"""

from __future__ import annotations

from app.services.converters import documents, language, pdf_pages, subtitles, tables, text
from app.services.converters.documents import docx_to_markdown, html_to_markdown, markdown_to_docx
from app.services.converters.language import to_chinese_number, to_pinyin, to_upper_amount
from app.services.converters.tables import convert as convert_table  # noqa: F401  (public API surface)
from app.services.converters.text import (
    detect_encoding,
    fullwidth_to_halfwidth,
    halfwidth_to_fullwidth,
    normalize_punctuation,
    transcode,
)

# Group key -> (human label, availability probe, hint shown when unavailable)
GROUPS = {
    "subtitles": ("字幕互转", subtitles.available, subtitles.unavailable_reason),
    "text": ("中文排版", lambda: True, lambda: ""),
    "tables": ("表格互转", lambda: True, lambda: ""),
    "documents": ("文档互转", documents.html_available, documents.unavailable_reason),
    "pdf": ("PDF 页面", pdf_pages.available, pdf_pages.unavailable_reason),
    "language": ("数字与拼音", language.pinyin_available, language.pinyin_unavailable_reason),
}

# Capability names are stable identifiers the front end dispatches on.
CAPABILITIES = {
    "subtitles": ["srt", "vtt", "ass", "ssa", "lrc", "merge", "split"],
    "text": ["transcode", "fullwidth_to_halfwidth", "halfwidth_to_fullwidth", "punctuation_to_zh", "punctuation_to_en"],
    "tables": ["csv", "tsv", "json", "markdown", "html"],
    "documents": ["html_to_markdown", "docx_to_markdown", "markdown_to_docx"],
    "pdf": ["merge", "split", "extract", "delete", "rotate", "watermark"],
    "language": ["upper_amount", "chinese_number", "pinyin"],
}


def available_converters() -> dict[str, dict]:
    """Report every group, whether it works, and what it can do."""
    report: dict[str, dict] = {}
    for key, (label, probe, reason) in GROUPS.items():
        try:
            ok = bool(probe())
        except Exception:
            ok = False
        report[key] = {
            "label": label,
            "available": ok,
            "reason": "" if ok else reason(),
            "capabilities": CAPABILITIES[key],
        }
    report["text"]["encodings"] = list(text.SUPPORTED_ENCODINGS)
    return report


def convert_text(value: str, mode: str) -> str:
    """Route a typography request; the API layer only passes the mode through."""
    return text.apply_mode(value, mode)
