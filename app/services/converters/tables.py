"""Table format conversion for CSV, TSV, JSON, Markdown and HTML.

Nothing here needs a third-party package: the workbench already ships inside a
single virtual environment, and a table is small enough that the standard
library plus a strict little HTML scanner is the right amount of machinery.
"""

from __future__ import annotations

import csv
import io
import json
import re
from html.parser import HTMLParser

FORMATS = ("csv", "tsv", "json", "markdown", "html")
DELIMITERS = {"csv": ",", "tsv": "\t"}


class TableError(RuntimeError):
    pass


def convert(text: str, source: str, target: str) -> str:
    """Convert between two table formats using an intermediate row list."""
    source = _normalize(source)
    target = _normalize(target)
    rows = parse(text, source)
    return render(rows, target)


def parse(text: str, source: str) -> list[list[str]]:
    source = _normalize(source)
    if source in DELIMITERS:
        return _parse_delimited(text, DELIMITERS[source])
    if source == "json":
        return _parse_json(text)
    if source == "markdown":
        return _parse_markdown(text)
    if source == "html":
        return _parse_html(text)
    raise TableError(f"不支持的输入格式：{source}")


def render(rows: list[list[str]], target: str) -> str:
    target = _normalize(target)
    if target in DELIMITERS:
        return _render_delimited(rows, DELIMITERS[target])
    if target == "json":
        return _render_json(rows)
    if target == "markdown":
        return _render_markdown(rows)
    if target == "html":
        return _render_html(rows)
    raise TableError(f"不支持的输出格式：{target}")


def sniff_format(text: str) -> str:
    """Guess the source format so the UI can prefill the picker.

    A Markdown table is checked before the delimited formats: its rows contain
    pipes and commas, so a delimiter-first check would call every Markdown table
    a CSV.
    """
    stripped = text.lstrip()
    if stripped.startswith("<"):
        return "html"
    if re.match(r"^[\[{]", stripped):
        return "json"
    lines = [line for line in stripped.splitlines() if line.strip()]
    if len(lines) >= 2 and "|" in lines[0] and _is_separator_row(lines[1]):
        return "markdown"
    first_line = lines[0] if lines else ""
    if "\t" in first_line:
        return "tsv"
    return "csv"


def _normalize(value: str) -> str:
    candidate = (value or "").strip().lower()
    if candidate not in FORMATS:
        raise TableError(f"不支持的格式：{value}；可选：{', '.join(FORMATS)}")
    return candidate


def _parse_delimited(text: str, delimiter: str) -> list[list[str]]:
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    return [[cell.strip() for cell in row] for row in reader if any(cell.strip() for cell in row)]


def _render_delimited(rows: list[list[str]], delimiter: str) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=delimiter, lineterminator="\n")
    writer.writerows(rows)
    return buffer.getvalue()


def _parse_json(text: str) -> list[list[str]]:
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise TableError(f"JSON 解析失败：{exc}") from exc
    if isinstance(data, dict):
        # A wrapper object is common (`{"rows": [...]}`); take its first list.
        data = next((value for value in data.values() if isinstance(value, list)), [])
    if not isinstance(data, list) or not data:
        raise TableError("JSON 需要是对象数组，例如 [{\"a\": 1}]。")
    if isinstance(data[0], dict):
        headers: list[str] = []
        for item in data:
            if isinstance(item, dict):
                for key in item:
                    if key not in headers:
                        headers.append(key)
        rows = [headers]
        for item in data:
            if isinstance(item, dict):
                rows.append([_stringify(item.get(key, "")) for key in headers])
            else:
                rows.append([_stringify(item)])
        return rows
    return [[_stringify(cell) for cell in row] for row in data if isinstance(row, list)]


def _render_json(rows: list[list[str]]) -> str:
    if not rows:
        return "[]"
    headers, body = rows[0], rows[1:]
    payload = [dict(zip(headers, row)) for row in body]
    return json.dumps(payload, ensure_ascii=False, indent=2) + "\n"


def _stringify(value) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _parse_markdown(text: str) -> list[list[str]]:
    rows: list[list[str]] = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        if _is_separator_row(stripped):
            continue
        rows.append(_split_markdown_row(stripped))
    if not rows:
        raise TableError("没有找到 Markdown 表格行（需要以 | 开头）。")
    width = max(len(row) for row in rows)
    return [row + [""] * (width - len(row)) for row in rows]


def _split_markdown_row(line: str) -> list[str]:
    value = line.strip()
    if value.startswith("|"):
        value = value[1:]
    if value.endswith("|"):
        value = value[:-1]
    cells = re.split(r"(?<!\\)\|", value)
    return [cell.replace("\\|", "|").strip() for cell in cells]


def _is_separator_row(line: str) -> bool:
    """Return whether a row is a Markdown delimiter, accepting ``| - | - |``.

    One dash is enough: hand-written tables in the wild use a single dash, and
    the workbench's own Markdown renderer accepts it.
    """
    stripped = line.strip().strip("|").strip()
    if not stripped:
        return False
    cells = [cell.strip() for cell in stripped.split("|")]
    return all(re.fullmatch(r":?-+:?", cell) for cell in cells if cell != "")


def _render_markdown(rows: list[list[str]]) -> str:
    if not rows:
        return ""
    width = max(len(row) for row in rows)
    padded = [row + [""] * (width - len(row)) for row in rows]
    lines = [_markdown_line(padded[0]), _markdown_line(["---"] * width)]
    lines.extend(_markdown_line(row) for row in padded[1:])
    return "\n".join(lines) + "\n"


def _markdown_line(cells: list[str]) -> str:
    escaped = [cell.replace("|", "\\|").replace("\n", " ") for cell in cells]
    return "| " + " | ".join(escaped) + " |"


class _TableScanner(HTMLParser):
    """Collect the first <table> into a row/cell grid."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[str]] = []
        self._row: list[str] | None = None
        self._cell: list[str] | None = None
        self._depth = 0
        self._done = False

    def handle_starttag(self, tag: str, attrs) -> None:
        if self._done:
            return
        if tag == "table":
            self._depth += 1
        elif tag == "tr" and self._depth:
            self._row = []
        elif tag in {"td", "th"} and self._row is not None:
            self._cell = []
        elif tag == "br" and self._cell is not None:
            self._cell.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if self._done:
            return
        if tag in {"td", "th"} and self._cell is not None and self._row is not None:
            self._row.append("".join(self._cell).strip())
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if any(cell for cell in self._row):
                self.rows.append(self._row)
            self._row = None
        elif tag == "table":
            self._depth -= 1
            if self._depth <= 0:
                self._done = True

    def handle_data(self, data: str) -> None:
        if self._cell is not None:
            self._cell.append(data)


def _parse_html(text: str) -> list[list[str]]:
    scanner = _TableScanner()
    scanner.feed(text)
    if not scanner.rows:
        raise TableError("没有在 HTML 中找到 <table> 数据行。")
    width = max(len(row) for row in scanner.rows)
    return [row + [""] * (width - len(row)) for row in scanner.rows]


def _render_html(rows: list[list[str]]) -> str:
    if not rows:
        return "<table></table>\n"
    head, *body = rows
    lines = ["<table>", "  <thead>", "    <tr>"]
    lines.extend(f"      <th>{_escape(cell)}</th>" for cell in head)
    lines.extend(["    </tr>", "  </thead>", "  <tbody>"])
    for row in body:
        lines.append("    <tr>")
        lines.extend(f"      <td>{_escape(cell)}</td>" for cell in row)
        lines.append("    </tr>")
    lines.extend(["  </tbody>", "</table>"])
    return "\n".join(lines) + "\n"


def _escape(value: str) -> str:
    return (
        str(value)
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )
