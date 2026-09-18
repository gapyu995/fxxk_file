"""Language and number conversions: Chinese capital amounts, Chinese numerals
and pinyin annotation.

The first two are pure standard-library work. Pinyin uses pypinyin (MIT,
mozillazg/python-pinyin) and degrades to a clear error when it is missing.
"""

from __future__ import annotations

import re
from decimal import Decimal, InvalidOperation

try:  # pragma: no cover - exercised through the public helpers below
    from pypinyin import Style, lazy_pinyin
except Exception:  # pragma: no cover - optional dependency guard
    lazy_pinyin = None
    Style = None


FINANCIAL_DIGITS = "零壹贰叁肆伍陆柒捌玖"
PLAIN_DIGITS = "零一二三四五六七八九"
UNITS = ["", "十", "百", "千"]
FINANCIAL_UNITS = ["", "拾", "佰", "仟"]
SECTIONS = ["", "万", "亿", "万亿"]


class LanguageConversionError(RuntimeError):
    pass


def pinyin_available() -> bool:
    return lazy_pinyin is not None


def pinyin_unavailable_reason() -> str:
    return "未安装 pypinyin（pip install -r requirements-convert.txt）。"


def to_upper_amount(value: str | float | Decimal) -> str:
    """Render a money amount in Chinese financial capitals.

    ``1234.56`` becomes ``壹仟贰佰叁拾肆元伍角陆分``. Input is parsed as a
    decimal string so floating point rounding never changes a cent.
    """
    text = str(value).replace(",", "").replace("¥", "").replace("￥", "").strip()
    if not text:
        raise ValueError("金额不能为空。")
    try:
        amount = Decimal(text)
    except InvalidOperation as exc:
        raise ValueError(f"无法解析金额「{value}」。") from exc
    negative = amount < 0
    amount = abs(amount)
    if amount >= Decimal("1000000000000"):
        raise ValueError("金额超出支持范围（小于 1 万亿）。")
    amount = amount.quantize(Decimal("0.01"))
    yuan = int(amount)
    cents = int((amount - yuan) * 100)
    jiao, fen = divmod(cents, 10)

    parts: list[str] = []
    parts.append(_sectioned(yuan, FINANCIAL_DIGITS, FINANCIAL_UNITS) + "元" if yuan else "零元")
    if jiao == 0 and fen == 0:
        parts.append("整")
    else:
        if jiao:
            parts.append(FINANCIAL_DIGITS[jiao] + "角")
        elif fen:
            parts.append("零")
        if fen:
            parts.append(FINANCIAL_DIGITS[fen] + "分")
        else:
            parts.append("整")
    result = "".join(parts)
    return ("负" + result) if negative else result


def to_chinese_number(value: int) -> str:
    """Render an integer in plain Chinese numerals (一千二百三十四)."""
    if isinstance(value, bool) or not isinstance(value, int):
        raise ValueError("只能转换整数。")
    if value == 0:
        return "零"
    negative = value < 0
    text = _sectioned(abs(value), PLAIN_DIGITS, UNITS)
    # 一十 reads as 十 in everyday Chinese unless a larger unit precedes it.
    if text.startswith("一十"):
        text = text[1:]
    return ("负" + text) if negative else text


def to_pinyin(text: str, style: str = "plain") -> str:
    """Annotate Chinese text with pinyin.

    ``plain`` -> ``ni hao``; ``tone`` -> ``nǐ hǎo``; ``first`` -> ``n h``.
    Non-Chinese characters are passed through untouched.
    """
    if lazy_pinyin is None:
        raise LanguageConversionError(pinyin_unavailable_reason())
    target = (style or "plain").strip().lower()
    mapping = {
        "plain": Style.NORMAL,
        "tone": Style.TONE,
        "tone3": Style.TONE3,
        "first": Style.FIRST_LETTER,
    }
    if target not in mapping:
        raise LanguageConversionError(f"不支持的拼音风格：{style}；可选：{', '.join(mapping)}")
    if not str(text).strip():
        return ""
    return " ".join(lazy_pinyin(text, style=mapping[target]))


def _sectioned(value: int, digit_chars: str, units: list[str]) -> str:
    """Render an integer by four-digit sections with correct 零 placement.

    Splitting on 万/亿 is what makes the zero rules tractable: a lower section
    needs a leading 零 exactly when it is smaller than the section unit and a
    higher section already contributed text (10005 -> 一万零五, 100000000 -> 一亿).
    """
    if value == 0:
        return digit_chars[0]
    sections: list[int] = []
    remaining = value
    while remaining > 0:
        sections.append(remaining % 10000)
        remaining //= 10000
    parts: list[str] = []
    for index in range(len(sections) - 1, -1, -1):
        section = sections[index]
        if section == 0:
            if parts and not parts[-1].endswith(digit_chars[0]):
                parts.append(digit_chars[0])
            continue
        if parts and section < 1000 and not parts[-1].endswith(digit_chars[0]):
            parts.append(digit_chars[0])
        parts.append(_four_digits(section, digit_chars, units) + SECTIONS[index])
    return re.sub(f"{digit_chars[0]}{{2,}}", digit_chars[0], "".join(parts)).rstrip(digit_chars[0]) or digit_chars[0]


def _four_digits(value: int, digit_chars: str, units: list[str]) -> str:
    out: list[str] = []
    zero_pending = False
    for position in range(3, -1, -1):
        digit = (value // (10 ** position)) % 10
        if digit == 0:
            if out:
                zero_pending = True
            continue
        if zero_pending:
            out.append(digit_chars[0])
            zero_pending = False
        out.append(digit_chars[digit] + units[position])
    return "".join(out)
