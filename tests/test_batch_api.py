"""Tests for the paragraph filter and bulk actions, plus the HTTP contract.

The router is exercised through `fastapi.testclient` against a temporary data
root so the real document store, progress recalculation and response shape are
all covered without touching the user's files.
"""

from __future__ import annotations

import importlib
import json

import pytest
from fastapi.testclient import TestClient

from app.services.segment_batch import FILTER_VALUES, matches_filter


@pytest.fixture()
def client(tmp_path, monkeypatch):
    """Point the storage roots at a temp directory and hand back a test client."""
    import app.config as config

    monkeypatch.setenv("APP_DOWNLOAD_DIR", str(tmp_path))
    monkeypatch.setattr(config, "DATA_ROOT", tmp_path, raising=False)
    monkeypatch.setattr(config, "ROOT", tmp_path, raising=False)
    monkeypatch.setattr(config, "ENV_FILE", tmp_path / ".env", raising=False)

    import app.services.storage as storage

    importlib.reload(storage)
    monkeypatch.setattr(storage, "INBOX", tmp_path / "inbox")
    monkeypatch.setattr(storage, "ORIGINALS", tmp_path / "originals")
    monkeypatch.setattr(storage, "WORKSPACE", tmp_path / "workspace")
    monkeypatch.setattr(storage, "OUTPUT", tmp_path / "output")
    monkeypatch.setattr(storage, "GLOSSARIES", tmp_path / "glossaries")
    storage.ensure_directories()

    import app.api.dependencies as dependencies
    import app.api.routers.translation as translation
    import app.core.runtime as runtime

    monkeypatch.setattr(dependencies, "load_document", storage.load_document)
    monkeypatch.setattr(translation, "load_or_404", lambda document_id: dependencies.load_or_404(document_id))
    runtime.active_tasks.clear()

    from app.application import create_app

    application = create_app()
    with TestClient(application) as test_client:
        yield test_client, storage


def _seed(storage, segments: list[dict]) -> str:
    """Write a document record plus a matching DOCX original.

    Clearing translations re-exports the DOCX from a copy of the original, so the
    fixture needs a real file whose paragraph count matches the segment list.
    """
    from docx import Document as DocxDocument

    document_id = "abc123abc123"
    source = storage.ORIGINALS / "fixture.docx"
    template = DocxDocument()
    for segment in segments:
        template.add_paragraph(segment["source"])
    template.save(source)
    storage.save_document(
        {
            "id": document_id,
            "name": "fixture.docx",
            "original_path": "originals/fixture.docx",
            "source_language": "zh",
            "target_language": "en",
            "status": "ready",
            "progress": 0,
            "error": "",
            "retry": None,
            "created_at": "",
            "updated_at": "",
            "segments": segments,
        },
        render_files=False,
    )
    return document_id


def _segments() -> list[dict]:
    return [
        {"id": "s0001", "source": "a", "translation": "", "status": "empty", "locked": False},
        {"id": "s0002", "source": "b", "translation": "译文", "status": "machine", "locked": False},
        {"id": "s0003", "source": "c", "translation": "译文", "status": "edited", "locked": False},
        {"id": "s0004", "source": "d", "translation": "译文", "status": "reviewed", "locked": True},
        {"id": "s0005", "source": "e", "translation": "", "status": "queued", "locked": False},
    ]


def test_filter_values_are_the_documented_set():
    assert FILTER_VALUES == ("all", "empty", "machine", "edited", "reviewed", "locked", "untranslated")


def test_untranslated_includes_queued_segments():
    # "Waiting to be translated" is what the user sees for a queued paragraph,
    # so it must count as untranslated rather than as a finished state.
    assert matches_filter({"translation": "", "status": "queued", "locked": False}, "untranslated")


def test_batch_lock_returns_matched_and_changed_counts(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "untranslated", "action": "lock"})

    assert response.status_code == 200
    body = response.json()
    assert body["matched"] == 2
    assert body["changed"] == 2
    assert body["document"]["segments"][0]["locked"] is True
    stored = json.loads((storage.WORKSPACE / document_id / "document.json").read_text(encoding="utf-8"))
    assert sum(1 for segment in stored["segments"] if segment["locked"]) == 3


def test_batch_review_marks_machine_segments_and_locks_them(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "machine", "action": "review"})

    body = response.json()
    assert (body["matched"], body["changed"]) == (1, 1)
    assert body["document"]["segments"][1]["status"] == "reviewed"
    assert body["document"]["segments"][1]["locked"] is True


def test_batch_clear_skips_locked_segments(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "all", "action": "clear"})

    body = response.json()
    # Two unlocked paragraphs carry text; the locked reviewed one keeps its.
    assert body["changed"] == 2
    assert body["document"]["segments"][1]["translation"] == ""
    assert body["document"]["segments"][3]["translation"] == "译文"


def test_batch_clear_rewrites_the_export(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "all", "action": "clear"})

    assert response.status_code == 200, response.text
    assert (storage.OUTPUT / f"fixture_{document_id}_译文.docx").is_file()


def test_batch_reports_zero_changes_without_touching_the_file(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())
    before = (storage.WORKSPACE / document_id / "document.json").read_text(encoding="utf-8")

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "empty", "action": "clear"})

    assert response.json()["changed"] == 0
    assert (storage.WORKSPACE / document_id / "document.json").read_text(encoding="utf-8") == before


def test_batch_rejects_an_unknown_action(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/segments/batch", json={"filter": "all", "action": "delete"})

    assert response.status_code == 422


def test_batch_404s_for_an_unknown_document(client):
    test_client, _storage = client
    response = test_client.post("/api/documents/ffffffffffff/segments/batch", json={"filter": "all", "action": "lock"})
    assert response.status_code == 404


def test_cancel_without_a_task_is_a_no_op(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())

    response = test_client.post(f"/api/documents/{document_id}/cancel")

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "idle"
    assert "没有正在进行" in body["message"]


def test_cancel_resets_queued_segments(client):
    test_client, storage = client
    document_id = _seed(storage, _segments())
    document = storage.load_document(document_id)
    document["status"] = "translating"
    storage.save_document(document, render_files=False)

    response = test_client.post(f"/api/documents/{document_id}/cancel")

    body = response.json()
    # No task is running, so stopping is a no-op that still releases the
    # paragraphs a previous (interrupted) run left queued.
    assert body["status"] == "idle"
    assert body["document"]["segments"][4]["status"] == "empty"
