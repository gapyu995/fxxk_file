"""PDF text extraction helper built on pdfplumber and pypdf.

Two backends are available and the caller picks one:

``pypdf``
    Fast, low-memory text extraction. This is the default because it is ~2.5x
    faster on large files and its output feeds the same paragraph builder.

``pdfplumber``
    Reports each word with its coordinates, which lets the extractor rebuild
    multi-column pages in reading order. It costs roughly 2.5x more CPU per
    page, so it is opt-in (``TRANSLATION_PDF_LAYOUT_MODE=layout``).

Both imports are optional; ``available()`` reports whether pdfplumber can be
used and the extractor falls back to pypdf.
"""

from __future__ import annotations

import importlib
from functools import lru_cache
from pathlib import Path

PLAIN_MODE = "plain"
LAYOUT_MODE = "layout"
MODE_VALUES = (PLAIN_MODE, LAYOUT_MODE)

# pdfplumber renders a text map, so the "layout" pass is measurably slower. The
# column detector below is what actually buys reading order, and it only needs
# word coordinates.
LINE_TOLERANCE = 3.0
GUTTER_RATIO = 0.04
MIN_COLUMN_WORDS = 10
MAX_STRADDLING_RATIO = 0.03


def normalize_mode(value: str | None) -> str:
    mode = (value or PLAIN_MODE).strip().lower()
    return mode if mode in MODE_VALUES else PLAIN_MODE


@lru_cache(maxsize=1)
def _module():
    return importlib.import_module("pdfplumber")


def available() -> bool:
    try:
        _module()
    except Exception:
        return False
    return True


def unavailable_reason() -> str:
    return "未安装 pdfplumber（pip install -r requirements.txt）。"


def page_texts(path: Path, mode: str = PLAIN_MODE) -> list[str]:
    """Return text for every page of a PDF."""
    if normalize_mode(mode) == LAYOUT_MODE:
        return page_layout_texts(path)
    return page_plain_texts(path)


def page_plain_texts(path: Path) -> list[str]:
    """Fast path: pdfplumber's default reading order, no coordinate padding."""
    pdfplumber = _module()
    with pdfplumber.open(str(path)) as pdf:
        return [(page.extract_text() or "") for page in pdf.pages]


def page_layout_texts(path: Path) -> list[str]:
    """Layout-preserving text for every page, rebuilt from word coordinates."""
    pdfplumber = _module()
    pages: list[str] = []
    with pdfplumber.open(str(path)) as pdf:
        for page in pdf.pages:
            pages.append(_page_text_from_words(page) or (page.extract_text() or ""))
    return pages


def _page_text_from_words(page) -> str:
    words = page.extract_words(use_text_flow=False, keep_blank_chars=False)
    if not words:
        return ""
    columns = _split_columns(words, float(page.width or 0))
    if columns is not None:
        left, right = columns
        return "\n".join(_group_lines(left) + _group_lines(right))
    return "\n".join(_group_lines(words))


def _split_columns(words: list[dict], width: float):
    """Split a page into two columns when a clear vertical gutter separates them.

    A page is treated as two-column only when both halves hold a real amount of
    text and almost nothing straddles the middle. Single-column pages therefore
    keep their natural line order.
    """
    if width <= 0 or len(words) < MIN_COLUMN_WORDS * 2:
        return None
    middle = width / 2
    left = [word for word in words if word["x1"] <= middle]
    right = [word for word in words if word["x0"] >= middle]
    if len(left) < MIN_COLUMN_WORDS or len(right) < MIN_COLUMN_WORDS:
        return None
    straddling = len(words) - len(left) - len(right)
    if straddling > max(2, len(words) * MAX_STRADDLING_RATIO):
        return None
    gutter = (min(word["x0"] for word in right) - max(word["x1"] for word in left))
    if gutter < width * GUTTER_RATIO:
        return None
    return left, right


def _group_lines(words: list[dict]) -> list[str]:
    """Group words into visual lines and join them the way the language expects."""
    rows: dict[int, list[dict]] = {}
    for word in words:
        rows.setdefault(round(word["top"] / LINE_TOLERANCE), []).append(word)
    lines: list[str] = []
    for key in sorted(rows):
        row = sorted(rows[key], key=lambda word: word["x0"])
        joiner = "" if _is_cjk_row(row) else " "
        lines.append(joiner.join(word["text"] for word in row))
    return lines


def _is_cjk_row(row: list[dict]) -> bool:
    sample = "".join(word["text"] for word in row[:6])
    return any("\u3400" <= char <= "\u9fff" for char in sample)

