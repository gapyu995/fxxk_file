"""Optional offline OCR for scanned PDF pages.

RapidOCR (Apache-2.0, https://github.com/RapidAI/RapidOCR) runs PP-OCR models on
ONNX Runtime entirely offline. It is an optional dependency: when it is missing
the helpers report unavailability instead of breaking document import, and the
caller falls back to the existing "scanned PDF needs OCR" message.

Page rasterisation uses pypdfium2 (Apache-2.0/BSD-3-Clause,
https://github.com/pypdfium2-team/pypdfium2), the same library family already
used by the bundled PDF.js build for preview rendering.
"""

from __future__ import annotations

import importlib
from functools import lru_cache
from pathlib import Path
from typing import Any

OCR_RENDER_SCALE = 200 / 72  # ~200 DPI, a good speed/accuracy tradeoff for text
MAX_OCR_PAGES = 80


@lru_cache(maxsize=1)
def _engine() -> Any:
    module = importlib.import_module("rapidocr_onnxruntime")
    return module.RapidOCR()


def available() -> bool:
    """True when both the OCR engine and the PDF rasteriser can be imported."""
    try:
        importlib.import_module("rapidocr_onnxruntime")
        importlib.import_module("pypdfium2")
        importlib.import_module("PIL.Image")
        importlib.import_module("numpy")
    except Exception:
        return False
    return True


def unavailable_reason() -> str:
    return "未安装离线 OCR 组件（pip install -r requirements-ocr.txt）。"


def render_pdf_page(path: Path, index: int, scale: float = OCR_RENDER_SCALE):
    """Rasterise one PDF page (0-based) into a PIL image."""
    pdfium = importlib.import_module("pypdfium2")
    document = pdfium.PdfDocument(str(path))
    try:
        page = document[index]
        bitmap = page.render(scale=scale)
        return bitmap.to_pil().convert("RGB")
    finally:
        document.close()


def recognize(image) -> list[tuple[float, float, str]]:
    """Run OCR on a PIL image and return (y, x, text) tuples sorted top-to-bottom."""
    numpy = importlib.import_module("numpy")
    result, _ = _engine()(numpy.asarray(image))
    lines: list[tuple[float, float, str]] = []
    for row in result or []:
        try:
            box, text = row[0], row[1]
        except (TypeError, IndexError):
            continue
        text = str(text).strip()
        if not text:
            continue
        ys = [float(point[1]) for point in box]
        xs = [float(point[0]) for point in box]
        lines.append((sum(ys) / len(ys), min(xs), text))
    lines.sort(key=lambda item: (round(item[0] / 12), item[1]))
    return lines


def group_lines(lines: list[tuple[float, float, str]], gap: float = 1.8) -> list[str]:
    """Group recognised lines into paragraphs using vertical spacing.

    ``gap`` is a multiple of the typical line pitch: OCR lines within one
    paragraph sit roughly one pitch apart, so a larger jump starts a new
    paragraph. The reference pitch is the lower median of the observed gaps,
    which ignores the occasional paragraph-sized gap instead of being dragged up
    by it.
    """
    paragraphs: list[str] = []
    current: list[str] = []
    previous_y: float | None = None
    pitches: list[float] = []
    for y, _x, text in lines:
        if previous_y is not None:
            pitch = abs(y - previous_y)
            ordered = sorted(pitches + [pitch])
            reference = ordered[(len(ordered) - 1) // 2]
            if reference and pitch > reference * gap and current:
                paragraphs.append(" ".join(current))
                current = []
            pitches.append(pitch)
        current.append(text)
        previous_y = y
    if current:
        paragraphs.append(" ".join(current))
    return [item for item in (paragraph.strip() for paragraph in paragraphs) if item]


def extract_pdf_paragraphs(path: Path) -> list[str]:
    """OCR every page of a PDF and return paragraph text."""
    if not available():
        return []
    pdfium = importlib.import_module("pypdfium2")
    document = pdfium.PdfDocument(str(path))
    try:
        page_count = min(len(document), MAX_OCR_PAGES)
    finally:
        document.close()

    paragraphs: list[str] = []
    for index in range(page_count):
        image = render_pdf_page(path, index)
        paragraphs.extend(group_lines(recognize(image)))
    return [paragraph for paragraph in paragraphs if paragraph.strip()]
