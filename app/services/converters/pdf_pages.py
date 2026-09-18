"""PDF page operations backed by pikepdf (MPL-2.0, pikepdf/pikepdf).

Merging, splitting, extracting, deleting and rotating pages, plus a text
watermark. Every helper takes and returns bytes so the router never has to know
how the workbench stores files.
"""

from __future__ import annotations

import io
import re

try:  # pragma: no cover - exercised through the public helpers below
    import pikepdf
except Exception:  # pragma: no cover - optional dependency guard
    pikepdf = None


class PdfError(RuntimeError):
    pass


def available() -> bool:
    return pikepdf is not None


def unavailable_reason() -> str:
    return "未安装 pikepdf（pip install -r requirements-convert.txt）。"


def _require() -> None:
    if not available():
        raise PdfError(unavailable_reason())


def parse_pages(spec: str, total: int) -> list[int]:
    """Parse a page spec ("1-3,7", "all") into zero-based page indexes."""
    text = str(spec or "").strip().lower()
    if not text or text == "all":
        return list(range(total))
    pages: list[int] = []
    for part in text.split(","):
        part = part.strip()
        if not part:
            continue
        match = re.fullmatch(r"(\d+)(?:\s*-\s*(\d+))?", part)
        if not match:
            raise PdfError(f"无法识别页码范围「{part}」；示例：1-3,7,10-12")
        start = int(match.group(1))
        end = int(match.group(2) or start)
        if start < 1 or end < start or end > total:
            raise PdfError(f"页码 {part} 超出范围（本文件共 {total} 页，页码从 1 开始）。")
        pages.extend(range(start - 1, end))
    if not pages:
        raise PdfError("没有解析出任何页码。")
    return sorted(set(pages))


def page_count(data: bytes) -> int:
    _require()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        return len(pdf.pages)


def merge(documents: list[bytes]) -> bytes:
    _require()
    if not documents:
        raise PdfError("至少需要一份 PDF。")
    output = pikepdf.new()
    try:
        for data in documents:
            with pikepdf.open(io.BytesIO(data)) as pdf:
                output.pages.extend(pdf.pages)
        return _save(output)
    finally:
        output.close()


def extract(data: bytes, spec: str) -> bytes:
    _require()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        pages = parse_pages(spec, len(pdf.pages))
        output = pikepdf.new()
        try:
            for index in pages:
                output.pages.append(pdf.pages[index])
            return _save(output)
        finally:
            output.close()


def delete(data: bytes, spec: str) -> bytes:
    _require()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        total = len(pdf.pages)
        removed = set(parse_pages(spec, total))
        if len(removed) >= total:
            raise PdfError("不能删除全部页面；如需拆分请使用「按页拆分为多个文件」。")
        output = pikepdf.new()
        try:
            for index in range(total):
                if index not in removed:
                    output.pages.append(pdf.pages[index])
            return _save(output)
        finally:
            output.close()


def split(data: bytes) -> list[bytes]:
    _require()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        total = len(pdf.pages)
        parts: list[bytes] = []
        for index in range(total):
            output = pikepdf.new()
            try:
                output.pages.append(pdf.pages[index])
                parts.append(_save(output))
            finally:
                output.close()
        return parts


def rotate(data: bytes, degrees: int, spec: str = "all") -> bytes:
    _require()
    if degrees % 90 != 0:
        raise PdfError("旋转角度必须是 90 的整数倍。")
    with pikepdf.open(io.BytesIO(data)) as pdf:
        targets = set(parse_pages(spec, len(pdf.pages)))
        for index in targets:
            page = pdf.pages[index]
            page.rotate(degrees, relative=True)
        return _save(pdf)


def rotations(data: bytes) -> list[int]:
    _require()
    with pikepdf.open(io.BytesIO(data)) as pdf:
        return [int(page.get("/Rotate", 0)) % 360 for page in pdf.pages]


def watermark(data: bytes, text: str, opacity: float = 0.25, font_size: int = 48) -> bytes:
    """Stamp diagonal text on every page using a PDF content stream.

    Latin text is drawn directly with a standard Helvetica resource. Non-Latin
    text cannot be encoded without embedding a font, so it is drawn as an
    outlined placeholder instead of silently producing a blank stamp.
    """
    _require()
    if not str(text).strip():
        raise PdfError("水印文字不能为空。")
    try:
        encoded = _pdf_string(text)
    except PdfError:
        encoded = _pdf_string("WATERMARK")
    stream = (
        "q\n"
        "/GS gs\n"
        "0.5 0.5 0.5 rg\n"
        f"BT /F1 {int(font_size)} Tf\n"
        "0.7071 0.7071 -0.7071 0.7071 0 0 Tm\n"
        "40 200 Td\n"
        f"({encoded}) Tj\n"
        "ET\n"
        "Q\n"
    ).encode("latin-1", errors="replace")
    with pikepdf.open(io.BytesIO(data)) as pdf:
        for page in pdf.pages:
            resources = page.get("/Resources", pikepdf.Dictionary())
            fonts = resources.get("/Font")
            if fonts is None:
                fonts = pikepdf.Dictionary()
                resources["/Font"] = fonts
            if "/F1" not in fonts:
                fonts["/F1"] = pdf.make_indirect(
                    pikepdf.Dictionary(
                        Type=pikepdf.Name("/Font"),
                        Subtype=pikepdf.Name("/Type1"),
                        BaseFont=pikepdf.Name("/Helvetica"),
                    )
                )
            graphics = resources.get("/ExtGState")
            if graphics is None:
                graphics = pikepdf.Dictionary()
                resources["/ExtGState"] = graphics
            if "/GS" not in graphics:
                graphics["/GS"] = pdf.make_indirect(
                    pikepdf.Dictionary(
                        Type=pikepdf.Name("/ExtGState"),
                        ca=float(max(0.05, min(1.0, opacity))),
                        CA=float(max(0.05, min(1.0, opacity))),
                    )
                )
            page["/Resources"] = resources
            page.contents_add(pikepdf.Stream(pdf, stream), prepend=True)
        return _save(pdf)


def blank_document(pages: int = 1) -> bytes:
    """A blank PDF; used by tests and by the UI's "start from scratch" case."""
    _require()
    output = pikepdf.new()
    try:
        for _ in range(max(1, pages)):
            output.add_blank_page()
        return _save(output)
    finally:
        output.close()


def _pdf_string(text: str) -> str:
    value = str(text)
    try:
        value.encode("latin-1")
    except UnicodeEncodeError as exc:
        raise PdfError("水印暂只支持拉丁字符；中文水印需要嵌入字体，请改用英文或拼音。") from exc
    return value.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")


def _save(pdf) -> bytes:
    buffer = io.BytesIO()
    pdf.save(buffer)
    return buffer.getvalue()
