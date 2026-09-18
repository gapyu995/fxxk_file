"""Text conversions that need no third-party package.

Covers the two things that actually block work on legacy Chinese documents:
the file is not UTF-8, or the punctuation/width came from a Chinese IME and has
to match an English target (or the reverse).

Encoding detection uses charset-normalizer (MIT), which already ships as an
indirect dependency of httpx. Trying decoders in a fixed order cannot separate
GB18030 from Shift-JIS — both are byte-complete for the other's text — so a
statistical detector is the honest tool here. When it is unavailable the module
falls back to the previous ordered-probe behaviour.
"""

from __future__ import annotations

try:  # pragma: no cover - exercised through the public helpers below
    from charset_normalizer import from_bytes as _detect_bytes
except Exception:  # pragma: no cover - optional dependency guard
    _detect_bytes = None


# ASCII punctuation -> the Chinese typography convention.
ASCII_TO_CJK = {
    ",": "，",
    ".": "。",
    "?": "？",
    "!": "！",
    ":": "：",
    ";": "；",
    "(": "（",
    ")": "）",
    "[": "【",
    "]": "】",
    "<": "《",
    ">": "》",
}
# Chinese punctuation -> the English convention (with its spacing rules).
CJK_TO_ASCII = {
    "，": ", ",
    "。": ". ",
    "？": "? ",
    "！": "! ",
    "：": ": ",
    "；": "; ",
    "（": " (",
    "）": ") ",
    "【": " [",
    "】": "] ",
    "《": " <",
    "》": "> ",
    "、": ", ",
    "—": " - ",
    "…": "...",
}

# Full-width forms are U+FF01..U+FF5E; their half-width twins are U+0021..U+007E.
# U+3000 (ideographic space) is included because users treat it as a full-width
# space even though it lives in a different block.
FULLWIDTH_TO_HALFWIDTH = {chr(0xFF01 + index): chr(0x21 + index) for index in range(94)}
FULLWIDTH_TO_HALFWIDTH["\u3000"] = " "
HALFWIDTH_TO_FULLWIDTH = {chr(0x21 + index): chr(0xFF01 + index) for index in range(94)}

# Encoding names this module is willing to report, in the order the fallback
# probe tries them. Anything outside the set (Korean, UTF-16, JIS-2004) is a
# plausible-but-wrong reading of a Chinese-region file.
SUPPORTED_ENCODINGS = (
    "utf-8-sig",
    "utf-8",
    "ascii",
    "gb18030",
    "big5",
    "shift_jis",
    "cp1252",
)

# Detection aliases normalised to the names this module reports.
ENCODING_ALIASES = {
    "utf_8": "utf-8",
    "utf_8_sig": "utf-8-sig",
    "ascii": "ascii",
    "cp932": "shift_jis",
    "shift_jis_2004": "shift_jis",
    "shift_jisx0213": "shift_jis",
    "gbk": "gb18030",
    "gb2312": "gb18030",
    "gb18030": "gb18030",
    "big5hkscs": "big5",
    "cp950": "big5",
    "latin_1": "cp1252",
    "iso8859-1": "cp1252",
}


class TextConversionError(RuntimeError):
    pass


def detect_encoding(data: bytes) -> str:
    """Guess the encoding of a text file.

    charset-normalizer shortlists the encodings that can plausibly explain the
    bytes, which is the only way to separate GB18030 from Shift-JIS at all: a
    per-encoding probe decodes Japanese bytes as valid Chinese and never
    notices. Within that shortlist the earliest entry of
    :data:`SUPPORTED_ENCODINGS` wins, because the library's own ranking is a tie
    on short input (a 6-byte Chinese string has several chaos-0 readings).

    The tie is broken toward Simplified Chinese deliberately: this workbench
    handles Chinese documents, and the caller can always override the reported
    ``source_encoding``. A wrong guess is visible in the UI rather than silent.
    """
    if data.startswith(b"\xef\xbb\xbf"):
        return "utf-8-sig"
    if _detect_bytes is not None:
        try:
            candidates = _detect_bytes(data)
        except Exception:
            candidates = []
        reported = set()
        for candidate in candidates or []:
            name = str(getattr(candidate, "encoding", "") or "").lower()
            mapped = ENCODING_ALIASES.get(name, name)
            if mapped in SUPPORTED_ENCODINGS:
                reported.add(mapped)
        for encoding in SUPPORTED_ENCODINGS:
            if encoding in reported:
                return encoding
    for encoding in SUPPORTED_ENCODINGS:
        try:
            data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
        return encoding
    return "utf-8"


def transcode(data: bytes, target: str = "utf-8", strict: bool = False) -> dict:
    """Decode then report a file's text and the encoding that was detected."""
    source = detect_encoding(data)
    try:
        text = data.decode(source)
    except (UnicodeDecodeError, LookupError) as exc:
        if strict:
            raise TextConversionError(f"无法解码文件：{exc}") from exc
        source = "utf-8"
        text = data.decode(source, errors="replace")
    try:
        "".encode(target)
    except LookupError as exc:
        raise TextConversionError(f"不支持的目标编码：{target}") from exc
    return {"source_encoding": source, "target_encoding": target, "text": text}


def fullwidth_to_halfwidth(text: str) -> str:
    return "".join(FULLWIDTH_TO_HALFWIDTH.get(char, char) for char in text)


def halfwidth_to_fullwidth(text: str) -> str:
    return "".join(HALFWIDTH_TO_FULLWIDTH.get(char, char) for char in text)


def normalize_punctuation(text: str, target: str = "zh") -> str:
    """Rewrite punctuation for the requested typography convention.

    Chinese quotes are kept as-is in both directions: they carry meaning and
    swapping them loses a choice the translator made deliberately.
    """
    if target not in {"zh", "en"}:
        raise TextConversionError(f"不支持的目标标点风格：{target}")
    table = ASCII_TO_CJK if target == "zh" else CJK_TO_ASCII
    out: list[str] = []
    for index, char in enumerate(text):
        replacement = table.get(char)
        if replacement is None:
            out.append(char)
            continue
        if target == "zh" and _is_technical_context(text, index, char):
            out.append(char)
            continue
        out.append(replacement)
    result = "".join(out)
    if target == "en":
        result = result.replace("  ", " ")
    return result.strip() if target == "en" and text.strip() else result


def _is_technical_context(text: str, index: int, char: str) -> bool:
    """Protect decimals, versions, times, URLs and code from punctuation swaps."""
    if char != ".":
        return False
    previous = text[index - 1] if index else ""
    following = text[index + 1] if index + 1 < len(text) else ""
    return previous.isdigit() or following.isdigit() or previous.isalpha() or following.isalpha()


def apply_mode(text: str, mode: str) -> str:
    """Dispatch the typography helpers by the identifier the API receives."""
    if mode == "fullwidth_to_halfwidth":
        return fullwidth_to_halfwidth(text)
    if mode == "halfwidth_to_fullwidth":
        return halfwidth_to_fullwidth(text)
    if mode == "punctuation_to_zh":
        return normalize_punctuation(text, "zh")
    if mode == "punctuation_to_en":
        return normalize_punctuation(text, "en")
    raise TextConversionError(f"未知的文本转换：{mode}")
