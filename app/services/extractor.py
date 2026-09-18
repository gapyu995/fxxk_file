from __future__ import annotations

import re
import shutil
import subprocess
import tempfile
from pathlib import Path

from docx import Document

from app.services import ocr, pdf_layout
from app.services.segmenter import join_lines

try:  # pypdf stays the dependency-light fallback when pdfplumber is missing.
    from pypdf import PdfReader
except Exception:  # pragma: no cover - pypdf is a hard requirement
    PdfReader = None


SUPPORTED_EXTENSIONS = {".doc", ".docx", ".pdf"}


class ExtractionError(RuntimeError):
    pass


def extract_paragraphs(
    path: Path,
    allow_ocr: bool = False,
    layout_mode: str = pdf_layout.PLAIN_MODE,
) -> list[str]:
    suffix = path.suffix.lower()
    if suffix not in SUPPORTED_EXTENSIONS:
        raise ExtractionError(f"不支持 {suffix or '无扩展名'} 文件；请使用 DOC、DOCX 或 PDF。")
    if suffix == ".docx":
        return _extract_docx(path)
    if suffix == ".pdf":
        return _extract_pdf(path, allow_ocr=allow_ocr, layout_mode=layout_mode)
    return _extract_legacy_doc(path)


def _extract_docx(path: Path) -> list[str]:
    try:
        document = Document(path)
    except Exception as exc:
        raise ExtractionError(f"DOCX 文件无法读取：{exc}") from exc

    # Only text-bearing paragraphs become translation units. Paragraphs that
    # contain images but no text are intentionally skipped and remain intact
    # when the translated DOCX is produced from the original template.
    blocks = [paragraph.text.strip() for paragraph in iter_docx_text_paragraphs(document)]
    if not blocks:
        raise ExtractionError("DOCX 中没有发现可提取的文字。")
    return blocks


def _extract_pdf(path: Path, allow_ocr: bool = False, layout_mode: str = pdf_layout.PLAIN_MODE) -> list[str]:
    """Extract PDF text, falling back through pdfplumber, pypdf and OCR.

    pdfplumber's default mode is fast and produces one paragraph per visual
    block; the optional ``layout`` mode rebuilds pages from word coordinates to
    recover reading order in multi-column files at roughly 2.5x the CPU cost.
    pypdf remains the fallback when pdfplumber is missing or a page fails.
    """
    blocks = _extract_pdf_pdfplumber(path, layout_mode)
    if not blocks and PdfReader is not None:
        blocks = _extract_pdf_plain(path)
    if not blocks and allow_ocr and ocr.available():
        blocks = _extract_pdf_ocr(path)
    if not blocks:
        if not allow_ocr and ocr.available():
            raise ExtractionError(
                "PDF 中没有可提取文字；它可能是扫描件。可开启「导入时自动 OCR」后重新上传，"
                "或先用其他工具添加 OCR 文本层。"
            )
        if allow_ocr and not ocr.available():
            raise ExtractionError(
                "PDF 中没有可提取文字，且未安装离线 OCR 组件。可执行 "
                "pip install -r requirements-ocr.txt 后重试。"
            )
        raise ExtractionError("PDF 中没有可提取文字；它可能是扫描件，需要先进行 OCR。")
    return blocks


def _extract_pdf_pdfplumber(path: Path, layout_mode: str) -> list[str]:
    if not pdf_layout.available():
        return []
    try:
        pages = pdf_layout.page_texts(path, layout_mode)
    except Exception:
        # A malformed page should not cost the user the pypdf fallback.
        return []
    blocks: list[str] = []
    for text in pages:
        blocks.extend(_paragraphs_from_text(text))
    return blocks


def _extract_pdf_plain(path: Path) -> list[str]:
    try:
        reader = PdfReader(str(path))
        blocks: list[str] = []
        for page in reader.pages:
            text = page.extract_text() or ""
            blocks.extend(_paragraphs_from_text(text))
    except Exception as exc:
        raise ExtractionError(f"PDF 文件无法读取：{exc}") from exc
    return blocks


def _extract_pdf_ocr(path: Path) -> list[str]:
    try:
        return ocr.extract_pdf_paragraphs(path)
    except Exception as exc:
        raise ExtractionError(f"扫描件 OCR 失败：{exc}") from exc


def _extract_legacy_doc(path: Path) -> list[str]:
    with tempfile.TemporaryDirectory(prefix="fxxk_file-") as temp_dir:
        converted = convert_legacy_doc(path, Path(temp_dir))
        return _extract_docx(converted)


def find_soffice() -> str | None:
    found = shutil.which("soffice") or shutil.which("libreoffice")
    if found:
        return found
    candidates = (
        Path("C:/Program Files/LibreOffice/program/soffice.exe"),
        Path("C:/Program Files (x86)/LibreOffice/program/soffice.exe"),
    )
    return str(next((item for item in candidates if item.exists()), "")) or None


def convert_legacy_doc(path: Path, output_dir: Path) -> Path:
    soffice = find_soffice()
    if not soffice:
        raise ExtractionError("读取旧版 .doc 需要安装 LibreOffice。也可以先在 Word 中另存为 .docx。")
    output_dir.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [soffice, "--headless", "--convert-to", "docx", "--outdir", str(output_dir), str(path)],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    converted = output_dir / f"{path.stem}.docx"
    if result.returncode != 0 or not converted.exists():
        detail = (result.stderr or result.stdout).strip()
        raise ExtractionError(f"LibreOffice 转换 .doc 失败：{detail or '未知错误'}")
    return converted


def iter_docx_text_paragraphs(document):
    """Yield all non-empty body/table paragraphs in a reproducible order."""
    for paragraph in document.paragraphs:
        if paragraph.text.strip():
            yield paragraph
    seen_cells: set = set()
    for table in document.tables:
        for row in table.rows:
            for cell in row.cells:
                # Merged cells are reported once per spanned row. The set holds
                # the ``w:tc`` elements themselves: ``id()`` values are recycled
                # once python-docx's temporary cell proxies are collected, which
                # used to make this iterator return a different number of
                # paragraphs for the same file on the import and export passes.
                if cell._tc in seen_cells:
                    continue
                seen_cells.add(cell._tc)
                for paragraph in cell.paragraphs:
                    if paragraph.text.strip():
                        yield paragraph


def _paragraphs_from_text(text: str) -> list[str]:
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    paragraphs: list[str] = []
    current: list[str] = []
    for line in text.split("\n"):
        stripped = line.strip()
        if not stripped:
            if current:
                paragraphs.append(join_lines(current))
                current = []
        else:
            current.append(_collapse_layout_gaps(stripped))
    if current:
        paragraphs.append(join_lines(current))
    return paragraphs


def _collapse_layout_gaps(line: str) -> str:
    """Shrink the wide spacing pdfplumber inserts to preserve layout.

    ``extract_text(layout=True)`` pads words with runs of spaces so columns line
    up visually. Collapsing every run to a single space keeps word order and
    removes the artificial gaps; ``join_lines`` then decides whether a space
    belongs between wrapped lines.
    """
    return re.sub(r"[ \t]{2,}", " ", line).strip()
