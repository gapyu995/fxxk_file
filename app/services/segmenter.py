from __future__ import annotations

import re


CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
CJK_BOUNDARY_RE = re.compile(r"[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]")
SENTENCE_BOUNDARY_RE = re.compile(r"(?<=[。！？!?；;])|(?<=[.!?])(?=\s+[A-Z0-9\"'])")


def detect_language(text: str) -> str:
    visible = re.sub(r"\s+", "", text)
    if not visible:
        return "zh"
    cjk_count = len(CJK_RE.findall(visible))
    latin_count = len(re.findall(r"[A-Za-z]", visible))
    return "zh" if cjk_count >= max(2, latin_count * 0.18) else "en"


def split_into_segments(paragraphs: list[str], max_chars: int = 1200) -> list[str]:
    segments: list[str] = []
    for paragraph in paragraphs:
        text = _clean(paragraph)
        if not text:
            continue
        if len(text) <= max_chars:
            segments.append(text)
            continue
        segments.extend(_split_long_text(text, max_chars))
    return segments


def _split_long_text(text: str, max_chars: int) -> list[str]:
    sentences = [part.strip() for part in SENTENCE_BOUNDARY_RE.split(text) if part.strip()]
    chunks: list[str] = []
    current = ""
    for sentence in sentences:
        if len(sentence) > max_chars:
            if current:
                chunks.append(current)
                current = ""
            chunks.extend(sentence[i : i + max_chars] for i in range(0, len(sentence), max_chars))
        elif not current:
            current = sentence
        elif len(current) + 1 + len(sentence) <= max_chars:
            current = join_lines([current, sentence])
        else:
            chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks or [text]


def join_lines(lines: list[str]) -> str:
    """Join wrapped text lines, inserting a space only across non-CJK boundaries.

    PDF extraction and long-text chunking split text on line/sentence breaks.
    Chinese text must be rejoined without a space ("组合驾驶\n辅助系统" ->
    "组合驾驶辅助系统"), while wrapped English needs one ("senior\nprofessional").
    """
    if not lines:
        return ""
    result = lines[0]
    for line in lines[1:]:
        if not line:
            continue
        if result and CJK_BOUNDARY_RE.fullmatch(result[-1]) and CJK_BOUNDARY_RE.fullmatch(line[0]):
            result += line
        else:
            result += " " + line
    return result


def _clean(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()

