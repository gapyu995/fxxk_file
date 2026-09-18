"""Chinese script normalisation backed by zhconv.

The translator workbench may receive Traditional Chinese input while the target
reader expects Simplified Chinese (or the other way round). ``zhconv`` is a pure
Python converter (Apache-2.0, https://github.com/yichen0831/opencc-python) that
needs no native build, so it can ship as a hard dependency.

Every helper degrades to a no-op when zhconv is missing, keeping the rest of the
pipeline usable.
"""

from __future__ import annotations

try:  # pragma: no cover - exercised through the public helpers below
    from zhconv import convert as _convert
except Exception:  # pragma: no cover - optional dependency guard
    _convert = None


SIMPLIFIED = "simplified"
TRADITIONAL = "traditional"
AUTO = "auto"
OFF = "off"

MODE_VALUES = (AUTO, SIMPLIFIED, TRADITIONAL, OFF)

_TARGET_TAGS = {SIMPLIFIED: "zh-cn", TRADITIONAL: "zh-tw"}


def available() -> bool:
    """True when the zhconv converter could be imported."""
    return _convert is not None


def normalize_mode(value: str | None) -> str:
    mode = (value or AUTO).strip().lower()
    return mode if mode in MODE_VALUES else AUTO


def target_tag(mode: str) -> str | None:
    """Return the zhconv target tag for a mode, or None for auto/off."""
    return _TARGET_TAGS.get(normalize_mode(mode))


def effective_mode(mode: str | None, target_lang: str) -> str:
    """Resolve ``auto`` to a concrete direction for the given target language."""
    resolved = normalize_mode(mode)
    if resolved == AUTO:
        return SIMPLIFIED if target_lang == "zh" else OFF
    return resolved


def convert_script(text: str, mode: str) -> str:
    """Convert ``text`` to the requested Chinese script.

    ``auto`` and ``off`` return the input untouched; unknown modes are treated as
    ``auto``. A conversion failure returns the original text instead of raising.
    """
    if not text:
        return text
    tag = target_tag(mode)
    if tag is None or _convert is None:
        return text
    try:
        return _convert(text, tag)
    except Exception:
        return text


def normalize_translation(text: str, target_lang: str, mode: str | None) -> str:
    """Convert machine output to the configured Chinese script when relevant."""
    if not text or target_lang != "zh":
        return text
    resolved = effective_mode(mode, target_lang)
    if resolved == OFF:
        return text
    return convert_script(text, resolved)
