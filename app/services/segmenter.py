from __future__ import annotations

import re


CJK_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")
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
            current += " " + sentence
        else:
            chunks.append(current)
            current = sentence
    if current:
        chunks.append(current)
    return chunks or [text]


def _clean(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line).strip()

