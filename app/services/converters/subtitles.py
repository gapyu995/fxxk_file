"""Subtitle format conversion built on pysubs2 (MIT, tkarabela/pysubs2).

The workbench already produces bilingual text. Subtitle files are the other
place a translator meets the same problem, so this module converts between the
formats a media player or a video editor will accept, and merges or splits the
two language tracks that come back from the translator.
"""

from __future__ import annotations

import re
from pathlib import Path

try:  # pragma: no cover - exercised through the public helpers below
    import pysubs2
except Exception:  # pragma: no cover - optional dependency guard
    pysubs2 = None

# Extension -> pysubs2 format name. LRC is handled locally because pysubs2 has
# no writer for it.
READABLE_EXTENSIONS = {
    ".srt": "srt",
    ".vtt": "vtt",
    ".ass": "ass",
    ".ssa": "ssa",
    ".sub": "microdvd",
    ".lrc": "lrc",
}
WRITABLE_EXTENSIONS = {
    ".srt": "srt",
    ".vtt": "vtt",
    ".ass": "ass",
    ".ssa": "ssa",
    ".lrc": "lrc",
}
MERGED_SEPARATOR = "\n"


class SubtitleError(RuntimeError):
    pass


def available() -> bool:
    return pysubs2 is not None


def unavailable_reason() -> str:
    return "未安装 pysubs2（pip install -r requirements-convert.txt）。"


def supported_outputs() -> list[str]:
    return sorted(WRITABLE_EXTENSIONS)


def supported_inputs() -> list[str]:
    return sorted(READABLE_EXTENSIONS)


def convert(data: bytes | str, target_extension: str) -> str:
    """Convert one subtitle file to the requested format and return its text."""
    if not available():
        raise SubtitleError(unavailable_reason())
    extension = _normalize_extension(target_extension)
    text = _decode(data)
    subtitles = _load(text)
    if extension == ".lrc":
        return _to_lrc(subtitles)
    try:
        return subtitles.to_string(WRITABLE_EXTENSIONS[extension])
    except Exception as exc:  # pragma: no cover - pysubs2 raises many types
        raise SubtitleError(f"无法转换为 {extension}：{exc}") from exc


def merge(left: bytes | str, right: bytes | str, separator: str = MERGED_SEPARATOR) -> str:
    """Merge two subtitle tracks into one bilingual SRT.

    Cues are aligned by start time rather than by index: the two tracks usually
    come from the same source but one of them may carry re-timed or dropped
    cues, and index-based pairing silently shifts every line after the first
    mismatch.
    """
    first = _load(_decode(left))
    second = _load(_decode(right))
    merged = pysubs2.SSAFile()
    lookup = {}
    for event in second:
        lookup.setdefault(round(event.start / 40), []).append(event)
    used = set()
    for event in first:
        partners = _take_partners(lookup, event.start, used)
        text = event.plaintext
        for partner in partners:
            text = f"{text}{separator}{partner.plaintext}" if text else partner.plaintext
        merged.append(pysubs2.SSAEvent(start=event.start, end=event.end, text=text))
    for event in second:
        if id(event) in used:
            continue
        merged.append(pysubs2.SSAEvent(start=event.start, end=event.end, text=event.plaintext))
    merged.sort()
    return merged.to_string("srt")


def split(data: bytes | str) -> list[str]:
    """Split a bilingual subtitle file into one SRT per line of each cue."""
    subtitles = _load(_decode(data))
    lines = max((len(_cue_lines(event)) for event in subtitles), default=0)
    if lines < 2:
        raise SubtitleError("这个字幕文件没有检测到双语内容（每条字幕只有一行）。")
    tracks = [pysubs2.SSAFile() for _ in range(lines)]
    for event in subtitles:
        parts = _cue_lines(event)
        for index, track in enumerate(tracks):
            text = parts[index] if index < len(parts) else ""
            if not text:
                continue
            track.append(pysubs2.SSAEvent(start=event.start, end=event.end, text=text))
    return [track.to_string("srt") for track in tracks]


def info(data: bytes | str) -> dict:
    subtitles = _load(_decode(data))
    durations = [event.duration for event in subtitles]
    return {
        "events": len(subtitles),
        "format": getattr(subtitles, "format", "") or "",
        "duration_ms": max(durations, default=0),
        "bilingual": max((len(_cue_lines(event)) for event in subtitles), default=0) >= 2,
    }


def _take_partners(lookup: dict[int, list], start: int, used: set) -> list:
    """Return the second-track cues whose start is within one frame of this one."""
    bucket = round(start / 40)
    partners = []
    for key in (bucket, bucket - 1, bucket + 1):
        for event in lookup.get(key, []):
            if id(event) in used:
                continue
            if abs(event.start - start) > 40:
                continue
            used.add(id(event))
            partners.append(event)
    return partners


def _cue_lines(event) -> list[str]:
    text = re.sub(r"\{[^}]*\}", "", event.text)
    return [line.strip() for line in text.replace("\\N", "\n").replace("\\n", "\n").split("\n") if line.strip()]


def _normalize_extension(value: str) -> str:
    extension = str(value or "").strip().lower()
    if not extension.startswith("."):
        extension = "." + extension
    if extension not in WRITABLE_EXTENSIONS:
        raise SubtitleError(f"不支持的输出格式 {extension}；可选：{', '.join(supported_outputs())}")
    return extension


def _decode(data: bytes | str) -> str:
    if isinstance(data, str):
        return data
    for encoding in ("utf-8-sig", "utf-8", "gb18030", "big5", "cp1252"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def _load(text: str):
    if not available():
        raise SubtitleError(unavailable_reason())
    if text.lstrip().startswith("["):
        return _load_lrc(text)
    try:
        return pysubs2.SSAFile.from_string(text)
    except Exception as exc:
        raise SubtitleError(f"无法解析字幕文件：{exc}") from exc


_LRC_LINE = re.compile(r"\[(?P<minutes>\d+):(?P<seconds>\d+(?:[.:]\d+)?)\](?P<text>.*)")


def _load_lrc(text: str):
    subtitles = pysubs2.SSAFile()
    for line in text.splitlines():
        match = _LRC_LINE.match(line.strip())
        if not match:
            continue
        seconds = int(match.group("minutes")) * 60 + float(match.group("seconds").replace(":", "."))
        content = match.group("text").strip()
        if not content:
            continue
        start = int(seconds * 1000)
        subtitles.append(pysubs2.SSAEvent(start=start, end=start + 2000, text=content))
    if not subtitles:
        raise SubtitleError("LRC 文件里没有解析到歌词行。")
    return subtitles


def _to_lrc(subtitles) -> str:
    lines = []
    for event in subtitles:
        total = max(0, event.start) / 1000
        minutes = int(total // 60)
        seconds = total - minutes * 60
        for text in _cue_lines(event) or [event.plaintext]:
            lines.append(f"[{minutes:02d}:{seconds:05.2f}]{text}")
    return "\n".join(lines) + "\n"
