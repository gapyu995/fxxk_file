"""HTTP-level tests for the file-conversion endpoints."""

from __future__ import annotations

import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

SRT = b"1\n00:00:01,000 --> 00:00:03,000\nHello there.\n\n2\n00:00:04,000 --> 00:00:06,000\nGeneral Kenobi!\n"
BILINGUAL = (
    "1\n00:00:01,000 --> 00:00:03,000\nHello there.\n你好。\n\n"
    "2\n00:00:04,000 --> 00:00:06,000\nGeneral Kenobi!\n肯诺比将军！\n"
).encode()


@pytest.fixture()
def client():
    from app.application import create_app

    with TestClient(create_app()) as test_client:
        yield test_client


def test_capabilities_reports_every_group(client):
    body = client.get("/api/convert/capabilities").json()
    groups = body["groups"]
    assert set(groups) >= {"subtitles", "text", "tables", "documents", "pdf", "language"}
    assert groups["tables"]["available"] is True
    assert "capabilities" in groups["pdf"]


def test_text_transcode_detects_legacy_encoding(client):
    response = client.post(
        "/api/convert/text",
        data={"mode": "transcode", "content": ""},
        files={"file": ("legacy.txt", "这是一个简体中文测试，内容包含常见字词。".encode("gb18030"), "text/plain")},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["source_encoding"] == "gb18030"
    assert body["text"].startswith("这是一个简体中文测试")


def test_text_fullwidth_to_halfwidth(client):
    response = client.post("/api/convert/text", data={"mode": "fullwidth_to_halfwidth", "content": "ＡＢＣ１２３"})
    assert response.json()["text"] == "ABC123"


def test_text_rejects_an_unknown_mode(client):
    response = client.post("/api/convert/text", data={"mode": "explode", "content": "x"})
    assert response.status_code == 422


def test_tables_convert_and_report_the_sniffed_source(client):
    response = client.post("/api/convert/tables", data={"data": "name,qty\nbolt,12\n", "source": "", "target": "markdown"})
    body = response.json()
    assert body["source"] == "csv"
    assert "| name | qty |" in body["text"]


def test_tables_reject_a_broken_json_payload(client):
    response = client.post("/api/convert/tables", data={"data": "{oops", "source": "json", "target": "csv"})
    assert response.status_code == 422


def test_html_to_markdown(client):
    response = client.post("/api/convert/documents/html_to_markdown", data={"content": "<h1>Title</h1><p>Body</p>"})
    assert "# Title" in response.json()["text"]


def test_docx_to_markdown_requires_a_file(client):
    response = client.post("/api/convert/documents/docx_to_markdown", data={"content": ""})
    assert response.status_code == 422


def test_markdown_to_docx_streams_a_download(client):
    response = client.post("/api/convert/documents/markdown_to_docx", data={"content": "# Title\n\nBody\n"})
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats")
    assert "attachment" in response.headers["content-disposition"]
    assert response.content[:2] == b"PK"


def test_subtitle_convert_returns_text_and_info(client):
    response = client.post(
        "/api/convert/subtitles/convert",
        data={"target": ".vtt"},
        files={"file": ("movie.srt", SRT, "text/plain")},
    )
    body = response.json()
    assert body["text"].startswith("WEBVTT")
    assert body["filename"] == "movie.vtt"
    assert body["info"]["events"] == 2


def test_subtitle_convert_rejects_an_unsupported_target(client):
    response = client.post(
        "/api/convert/subtitles/convert",
        data={"target": ".docx"},
        files={"file": ("movie.srt", SRT, "text/plain")},
    )
    assert response.status_code == 422


def test_subtitle_merge_aligns_by_time(client):
    response = client.post(
        "/api/convert/subtitles/merge",
        files={"first": ("en.srt", SRT, "text/plain"), "second": ("zh.srt", BILINGUAL, "text/plain")},
    )
    text = response.json()["text"]
    assert "肯诺比将军！" in text.split("\n\n")[1]


def test_subtitle_split_returns_one_file_per_language(client):
    response = client.post("/api/convert/subtitles/split", files={"file": ("both.srt", BILINGUAL, "text/plain")})
    files = response.json()["files"]
    assert [item["filename"] for item in files] == ["both.track1.srt", "both.track2.srt"]
    assert "你好。" in files[1]["text"]


def test_subtitle_split_rejects_single_language(client):
    response = client.post("/api/convert/subtitles/split", files={"file": ("en.srt", SRT, "text/plain")})
    assert response.status_code == 422


def _pdf(pages: int = 3) -> bytes:
    pytest.importorskip("pikepdf")
    from app.services.converters import pdf_pages

    return pdf_pages.blank_document(pages)


def test_pdf_merge_returns_a_single_document(client):
    response = client.post(
        "/api/convert/pdf/merge",
        files=[("files", ("a.pdf", _pdf(2), "application/pdf")), ("files", ("b.pdf", _pdf(1), "application/pdf"))],
    )
    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    from app.services.converters import pdf_pages

    assert pdf_pages.page_count(response.content) == 3


def test_pdf_extract_respects_the_page_spec(client):
    response = client.post(
        "/api/convert/pdf/extract",
        data={"pages": "1,3"},
        files=[("files", ("a.pdf", _pdf(4), "application/pdf"))],
    )
    from app.services.converters import pdf_pages

    assert pdf_pages.page_count(response.content) == 2


def test_pdf_extract_rejects_an_out_of_range_spec(client):
    response = client.post(
        "/api/convert/pdf/extract",
        data={"pages": "9"},
        files=[("files", ("a.pdf", _pdf(2), "application/pdf"))],
    )
    assert response.status_code == 422


def test_pdf_split_returns_a_downloadable_bundle(client):
    response = client.post("/api/convert/pdf/split", files=[("files", ("a.pdf", _pdf(3), "application/pdf"))])
    body = response.json()
    assert body["count"] == 3
    bundle = client.get(body["download_url"])
    assert bundle.status_code == 200
    with zipfile.ZipFile(io.BytesIO(bundle.content)) as archive:
        assert sorted(archive.namelist()) == ["page-001.pdf", "page-002.pdf", "page-003.pdf"]


def test_pdf_rotate_requests_a_right_angle(client):
    response = client.post(
        "/api/convert/pdf/rotate",
        data={"degrees": "45"},
        files=[("files", ("a.pdf", _pdf(1), "application/pdf"))],
    )
    assert response.status_code == 422


def test_pdf_watermark_returns_a_pdf(client):
    response = client.post(
        "/api/convert/pdf/watermark",
        data={"watermark_text": "DRAFT"},
        files=[("files", ("a.pdf", _pdf(2), "application/pdf"))],
    )
    assert response.status_code == 200
    from app.services.converters import pdf_pages

    assert pdf_pages.page_count(response.content) == 2


def test_pdf_endpoint_requires_a_file(client):
    response = client.post("/api/convert/pdf/merge", files=[])
    assert response.status_code == 422


def test_pdf_bundle_token_is_validated(client):
    assert client.get("/api/convert/output/not-a-token").status_code == 400
    assert client.get("/api/convert/output/abcdefabcdef").status_code == 404


def test_language_upper_amount(client):
    response = client.post("/api/convert/language", data={"mode": "upper_amount", "value": "1234.56"})
    assert response.json()["text"] == "壹仟贰佰叁拾肆元伍角陆分"


def test_language_chinese_number_rejects_a_decimal(client):
    response = client.post("/api/convert/language", data={"mode": "chinese_number", "value": "1.5"})
    assert response.status_code == 422


def test_language_pinyin_styles(client):
    assert client.post("/api/convert/language", data={"mode": "pinyin", "value": "你好"}).json()["text"] == "ni hao"
    assert client.post("/api/convert/language", data={"mode": "pinyin", "value": "你好", "style": "tone"}).json()["text"] == "nǐ hǎo"


def test_language_upper_amount_rejects_non_numeric(client):
    response = client.post("/api/convert/language", data={"mode": "upper_amount", "value": "abc"})
    assert response.status_code == 422
