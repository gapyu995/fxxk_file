"""Tests for the conversion toolkit.

Each converter is optional at runtime; tests that need a missing package skip so
a stock CI runner still exercises the dependency-free paths (encoding, tables,
numbers).
"""

from __future__ import annotations

import json

import pytest

from app.services.converters import (
    available_converters,
    convert_text,
    detect_encoding,
    fullwidth_to_halfwidth,
    halfwidth_to_fullwidth,
    html_to_markdown,
    normalize_punctuation,
    subtitles,
    tables,
    to_chinese_number,
    to_pinyin,
    to_upper_amount,
    transcode,
)

# --- subtitle conversion ---------------------------------------------------


SRT_SAMPLE = """1
00:00:01,000 --> 00:00:03,000
Hello there.

2
00:00:04,000 --> 00:00:06,500
General Kenobi!
"""

BILINGUAL_SRT = """1
00:00:01,000 --> 00:00:03,000
Hello there.
你好。

2
00:00:04,000 --> 00:00:06,500
General Kenobi!
肯诺比将军！
"""


class TestSubtitles:
    def test_srt_to_vtt_keeps_timings(self):
        assert subtitles.available()
        result = subtitles.convert(SRT_SAMPLE, ".vtt")
        assert result.startswith("WEBVTT")
        assert "00:00:01.000 --> 00:00:03.000" in result
        assert "Hello there." in result

    def test_srt_to_ass_keeps_text(self):
        result = subtitles.convert(SRT_SAMPLE, ".ass")
        assert "[Script Info]" in result
        assert "Hello there." in result

    def test_lrc_round_trip(self):
        lrc = subtitles.convert(SRT_SAMPLE, ".lrc")
        assert "[00:01.00]Hello there." in lrc
        back = subtitles.convert(lrc, ".srt")
        assert "Hello there." in back
        assert "00:00:01" in back

    def test_unknown_output_format_is_rejected(self):
        with pytest.raises(subtitles.SubtitleError):
            subtitles.convert(SRT_SAMPLE, ".docx")

    def test_bilingual_merge_aligns_by_start_time(self):
        merged = subtitles.merge(SRT_SAMPLE, BILINGUAL_SRT)
        assert "Hello there." in merged
        assert "肯诺比将军！" in merged
        # The Chinese line must land under its own cue, not the first one only.
        first_cue, second_cue = merged.split("\n\n")[0], merged.split("\n\n")[1]
        assert "肯诺比将军！" not in first_cue
        assert "肯诺比将军！" in second_cue

    def test_merge_keeps_track_two_cues_that_track_one_lacks(self):
        sparse = "1\n00:00:01,000 --> 00:00:02,000\nOnly one.\n"
        extra = SRT_SAMPLE
        merged = subtitles.merge(sparse, extra)
        assert "General Kenobi!" in merged

    def test_split_returns_one_track_per_line(self):
        tracks = subtitles.split(BILINGUAL_SRT)
        assert len(tracks) == 2
        assert "Hello there." in tracks[0]
        assert "你好。" in tracks[1]
        # Track one must carry only the first language of each cue.
        assert "General Kenobi!" in tracks[0]
        assert "肯诺比将军！" not in tracks[0]
        assert "肯诺比将军！" in tracks[1]

    def test_split_rejects_a_single_language_file(self):
        with pytest.raises(subtitles.SubtitleError):
            subtitles.split(SRT_SAMPLE)

    def test_info_reports_event_count_and_bilingual_flag(self):
        assert subtitles.info(BILINGUAL_SRT)["events"] == 2
        assert subtitles.info(BILINGUAL_SRT)["bilingual"] is True
        assert subtitles.info(SRT_SAMPLE)["bilingual"] is False

    def test_non_utf8_subtitle_bytes_are_decoded(self):
        data = SRT_SAMPLE.replace("Hello there.", "你好").encode("gb18030")
        result = subtitles.convert(data, ".vtt")
        assert "你好" in result


# --- text encoding and typography -----------------------------------------


class TestEncoding:
    def test_detects_gb18030_chinese(self):
        assert detect_encoding("中文测试".encode("gb18030")) == "gb18030"

    def test_detects_utf8_with_bom(self):
        assert detect_encoding("中文".encode("utf-8-sig")) == "utf-8-sig"

    def test_detects_shift_jis_japanese(self):
        assert detect_encoding("日本語のテストです。これはサンプル。".encode("shift_jis")) == "shift_jis"

    def test_detects_big5_traditional_chinese(self):
        assert detect_encoding("這是一個繁體中文測試，內容包含常見字詞。".encode("big5")) == "big5"

    def test_transcode_reports_the_detected_source_encoding(self):
        result = transcode("中文".encode("gb18030"), target="utf-8")
        assert result["source_encoding"] == "gb18030"
        assert result["text"] == "中文"
        assert result["target_encoding"] == "utf-8"

    def test_transcode_falls_back_to_replacement_instead_of_raising(self):
        result = transcode(b"\xff\xfe\x00bad", target="utf-8", strict=False)
        assert isinstance(result["text"], str)

    def test_fullwidth_to_halfwidth_converts_digits_and_letters(self):
        assert fullwidth_to_halfwidth("ＡＢＣ１２３") == "ABC123"

    def test_halfwidth_to_fullwidth_is_the_inverse(self):
        assert halfwidth_to_fullwidth("ABC123") == "ＡＢＣ１２３"

    def test_fullwidth_conversion_keeps_ideographic_space(self):
        # U+3000 is a full-width space, not a half-width one; converting it to a
        # plain space is what users expect from "full to half".
        assert fullwidth_to_halfwidth("全　角") == "全 角"

    def test_normalize_punctuation_to_simplified_chinese(self):
        assert normalize_punctuation("你好,世界!", "zh") == "你好，世界！"

    def test_normalize_punctuation_to_english(self):
        assert normalize_punctuation("你好，世界！", "en") == "你好, 世界!"

    def test_normalize_punctuation_handles_quotes(self):
        assert normalize_punctuation("他说“好”", "zh") == "他说“好”"


# --- tables ----------------------------------------------------------------


class TestTables:
    CSV = "name,qty\n螺栓,12\n垫圈,8\n"

    def test_csv_to_markdown(self):
        result = tables.convert(self.CSV, "csv", "markdown")
        assert "| name | qty |" in result
        assert "| 螺栓 | 12 |" in result

    def test_csv_to_json(self):
        rows = json.loads(tables.convert(self.CSV, "csv", "json"))
        assert rows[0]["name"] == "螺栓"
        assert rows[1]["qty"] == "8"

    def test_tsv_to_csv(self):
        assert tables.convert("a\tb\n1\t2\n", "tsv", "csv") == "a,b\n1,2\n"

    def test_json_to_csv(self):
        result = tables.convert(json.dumps([{"a": 1, "b": 2}]), "json", "csv")
        assert result.splitlines()[0] == "a,b"
        assert result.splitlines()[1] == "1,2"

    def test_markdown_to_csv(self):
        markdown = "| a | b |\n| :-- | --: |\n| 1 | 2 |\n"
        assert tables.convert(markdown, "markdown", "csv") == "a,b\n1,2\n"

    def test_html_to_csv(self):
        html = "<table><tr><th>a</th><th>b</th></tr><tr><td>1</td><td>2</td></tr></table>"
        assert tables.convert(html, "html", "csv") == "a,b\n1,2\n"

    def test_markdown_output_escapes_pipes(self):
        result = tables.convert("a\nx|y\n", "csv", "markdown")
        assert "x\\|y" in result

    def test_missing_cells_are_padded(self):
        result = tables.convert("a,b\n1\n", "csv", "markdown")
        lines = result.strip().splitlines()
        assert lines[0].count("|") == lines[2].count("|")
        assert lines[2] == "| 1 |  |"

    def test_unknown_format_is_rejected(self):
        with pytest.raises(tables.TableError):
            tables.convert("a", "csv", "xml")

    def test_sniff_format_from_content(self):
        assert tables.sniff_format("a,b\n1,2\n") == "csv"
        assert tables.sniff_format("| a | b |\n| - | - |\n") == "markdown"
        assert tables.sniff_format("a\tb\n") == "tsv"
        assert tables.sniff_format("[{\"a\": 1}]") == "json"
        assert tables.sniff_format("<table><tr><td>a</td></tr></table>") == "html"

    def test_markdown_output_renders_in_the_markdown_viewer(self):
        # The viewer's renderer needs its own delimiter to recognise a table, so
        # the emitter must produce exactly the `---` separator it accepts.
        markdown = tables.convert(self.CSV, "csv", "markdown")
        assert markdown.splitlines()[1] == "| --- | --- |"


# --- document conversion ---------------------------------------------------


class TestDocuments:
    def test_html_to_markdown_keeps_structure(self):
        html = "<h1>Title</h1><p>Body with <strong>bold</strong> and <a href='https://x.example'>link</a>.</p><ul><li>one</li><li>two</li></ul>"
        markdown = html_to_markdown(html)
        assert "# Title" in markdown
        assert "**bold**" in markdown
        assert "[link](https://x.example)" in markdown
        assert "- one" in markdown

    def test_html_to_markdown_strips_scripts(self):
        markdown = html_to_markdown("<p>safe</p><script>alert(1)</script>")
        assert "alert(1)" not in markdown
        assert "safe" in markdown

    def test_docx_to_markdown_uses_paragraphs_and_tables(self):
        from docx import Document

        from app.services.converters import docx_to_markdown

        document = Document()
        document.add_heading("Report", level=1)
        document.add_paragraph("First paragraph.")
        table = document.add_table(rows=2, cols=2)
        table.cell(0, 0).text = "Field"
        table.cell(0, 1).text = "Value"
        table.cell(1, 0).text = "Torque"
        table.cell(1, 1).text = "12 N·m"
        import io

        buffer = io.BytesIO()
        document.save(buffer)
        markdown = docx_to_markdown(buffer.getvalue())
        assert "# Report" in markdown
        assert "First paragraph." in markdown
        assert "| Field | Value |" in markdown

    def test_markdown_to_docx_round_trip(self):
        from docx import Document

        from app.services.converters import markdown_to_docx

        markdown = "# Title\n\nBody text.\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n"
        data = markdown_to_docx(markdown)
        document = Document(io_bytes(data))
        texts = [paragraph.text for paragraph in document.paragraphs]
        assert "Title" in texts
        assert "Body text." in texts
        assert document.tables


def io_bytes(data: bytes):
    import io

    return io.BytesIO(data)


# --- PDF pages -------------------------------------------------------------


class TestPdfPages:
    def _pdf(self, pages: int = 3) -> bytes:
        pytest.importorskip("pikepdf")
        from app.services.converters import pdf_pages

        return pdf_pages.blank_document(pages)

    def test_merge_and_page_count(self):
        from app.services.converters import pdf_pages

        merged = pdf_pages.merge([self._pdf(2), self._pdf(3)])
        assert pdf_pages.page_count(merged) == 5

    def test_extract_keeps_requested_pages(self):
        from app.services.converters import pdf_pages

        data = pdf_pages.extract(self._pdf(5), "2-3,5")
        assert pdf_pages.page_count(data) == 3

    def test_extract_accepts_single_page_and_rejects_out_of_range(self):
        from app.services.converters import pdf_pages

        assert pdf_pages.page_count(pdf_pages.extract(self._pdf(4), "4")) == 1
        with pytest.raises(pdf_pages.PdfError):
            pdf_pages.extract(self._pdf(4), "9")

    def test_delete_removes_pages(self):
        from app.services.converters import pdf_pages

        assert pdf_pages.page_count(pdf_pages.delete(self._pdf(5), "1,5")) == 3

    def test_delete_rejects_removing_every_page(self):
        from app.services.converters import pdf_pages

        with pytest.raises(pdf_pages.PdfError):
            pdf_pages.delete(self._pdf(2), "1-2")

    def test_split_produces_one_file_per_page(self):
        from app.services.converters import pdf_pages

        parts = pdf_pages.split(self._pdf(3))
        assert len(parts) == 3
        assert all(pdf_pages.page_count(part) == 1 for part in parts)

    def test_rotate_sets_page_rotation(self):
        from app.services.converters import pdf_pages

        rotated = pdf_pages.rotate(self._pdf(2), 90)
        rotations = pdf_pages.rotations(rotated)
        assert rotations == [90, 90]

    def test_rotate_rejects_a_non_right_angle(self):
        from app.services.converters import pdf_pages

        with pytest.raises(pdf_pages.PdfError):
            pdf_pages.rotate(self._pdf(1), 45)

    def test_watermark_keeps_the_page_count(self):
        from app.services.converters import pdf_pages

        stamped = pdf_pages.watermark(self._pdf(2), "内部资料", opacity=0.2)
        assert pdf_pages.page_count(stamped) == 2

    def test_page_range_parser(self):
        from app.services.converters import pdf_pages

        assert pdf_pages.parse_pages("1-3,7,9-10", 12) == [0, 1, 2, 6, 8, 9]
        assert pdf_pages.parse_pages("all", 3) == [0, 1, 2]
        with pytest.raises(pdf_pages.PdfError):
            pdf_pages.parse_pages("0", 3)


# --- numbers and pinyin ----------------------------------------------------


class TestNumbers:
    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            ("1234.56", "壹仟贰佰叁拾肆元伍角陆分"),
            ("0.07", "零元零柒分"),
            ("100", "壹佰元整"),
            ("10", "壹拾元整"),
            ("100000000", "壹亿元整"),
        ],
    )
    def test_amount_in_chinese_capital(self, value, expected):
        assert to_upper_amount(value) == expected

    def test_amount_rejects_non_numeric(self):
        with pytest.raises(ValueError):
            to_upper_amount("abc")

    @pytest.mark.parametrize(
        ("value", "expected"),
        [
            (1234, "一千二百三十四"),
            (10, "十"),
            (110, "一百一十"),
            (10005, "一万零五"),
            (0, "零"),
            (-42, "负四十二"),
        ],
    )
    def test_integer_to_chinese(self, value, expected):
        assert to_chinese_number(value) == expected

    def test_integer_to_chinese_rejects_floats(self):
        with pytest.raises(ValueError):
            to_chinese_number(1.5)

    def test_pinyin_plain(self):
        assert to_pinyin("你好") == "ni hao"

    def test_pinyin_with_tone_marks(self):
        assert to_pinyin("你好", style="tone") == "nǐ hǎo"

    def test_pinyin_initials_only(self):
        assert to_pinyin("中文测试", style="first") == "z w c s"

    def test_pinyin_keeps_non_chinese_text(self):
        assert "ABC" in to_pinyin("ABC你好")


# --- registry --------------------------------------------------------------


class TestRegistry:
    def test_registry_lists_every_group_with_availability(self):
        registry = available_converters()
        assert set(registry) >= {"subtitles", "text", "tables", "documents", "pdf", "language"}
        assert all("available" in item for item in registry.values())

    def test_free_conversions_are_always_available(self):
        registry = available_converters()
        assert registry["text"]["available"] is True
        assert registry["tables"]["available"] is True
        assert registry["language"]["available"] is True

    def test_convert_text_routes_typography_requests(self):
        assert convert_text("ＡＢ", "fullwidth_to_halfwidth") == "AB"
