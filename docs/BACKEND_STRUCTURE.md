# Backend structure and CI/CD contract

The backend is organized by responsibility. `app/main.py` is intentionally a
small ASGI entry point so Uvicorn, PyInstaller and deployment scripts can keep
using `app.main:app`.

```text
app/
├── main.py                     # stable ASGI entry: app = create_app()
├── application.py              # FastAPI factory, lifecycle and route wiring
├── api/
│   ├── schemas.py              # Pydantic request models
│   ├── dependencies.py         # shared document lookup/404 helpers
│   └── routers/
│       ├── system.py           # index, health and model settings
│       ├── documents.py        # upload, list, delete, preview and export
│       ├── translation.py      # segment editing, autosave, batch actions, stop and translation
│       └── conversions.py      # file-conversion endpoints (text, tables, subtitles, documents, PDF, language)
├── core/
│   └── runtime.py              # upload limit and active task registry
└── services/
    ├── converters/             # file-conversion toolkit, one module per group
    │   ├── subtitles.py        # SRT/VTT/ASS/SSA/LRC conversion, bilingual merge and split
    │   ├── text.py             # encoding detection, width and punctuation normalisation
    │   ├── tables.py           # CSV/TSV/JSON/Markdown/HTML table conversion
    │   ├── documents.py        # HTML→Markdown, DOCX↔Markdown
    │   ├── pdf_pages.py        # merge, split, extract, delete, rotate, watermark
    │   └── language.py         # Chinese capital amounts, Chinese numerals, pinyin
    ├── extractor.py            # DOCX/PDF text extraction (pdfplumber + pypdf + optional OCR)
    ├── pdf_layout.py           # pdfplumber wrapper and availability probe
    ├── ocr.py                  # optional RapidOCR + pypdfium2 scanned-PDF OCR
    ├── segmenter.py            # sentence segmentation (pySBD) and long-text chunking
    ├── segment_batch.py        # paragraph filter selection and bulk actions
    ├── text_normalize.py       # zhconv Traditional/Simplified conversion
    ├── preview.py              # DOCX/PDF browser preview pages
    └── translation_job.py      # batching, retry, progress and background jobs
```

## Module boundaries

- `api/routers` handles HTTP parameters, status codes and responses. It does
  not assemble the FastAPI application.
- `services` contains document and translation business logic and can be
  tested without an HTTP request. `segment_batch.py` is the pure selection
  logic behind `POST /api/documents/{id}/segments/batch`: the router only
  validates the request, persists the result and re-exports when needed.
- Bulk actions run against the persisted document, never against what the
  browser has rendered; a long document only renders part of its rows.
- `core/runtime.py` is the single source of process-level task state. Routers
  must not import `app.main` to share state.
- Existing API paths and response fields remain compatible. New endpoints
  should be added to the matching router with a schema when appropriate.

## Optional dependencies and how they degrade

Three integrations are optional at runtime; each exposes an `available()`
probe that `/api/settings` reports so the UI can disable the matching control.

| Module | Upstream project | License | Missing behaviour |
|---|---|---|---|
| `pdf_layout.py` | [pdfplumber](https://github.com/jsvine/pdfplumber) | MIT | PDF text falls back to `pypdf` |
| `ocr.py` | [RapidOCR](https://github.com/RapidAI/RapidOCR) + [pypdfium2](https://github.com/pypdfium2-team/pypdfium2) | Apache-2.0 | Scanned PDFs report "需要先进行 OCR"; install `requirements-ocr.txt` and enable `auto_ocr` |
| `segmenter.py` (pySBD) | [pySBD](https://github.com/nipunsadvilkar/pySBD) | MIT | Falls back to the previous regex sentence boundary rule |

The conversion toolkit follows the same rule, one probe per group, reported by
`GET /api/convert/capabilities`:

| Group | Upstream project | License | Missing behaviour |
|---|---|---|---|
| 字幕互转 | [pysubs2](https://github.com/tkarabela/pysubs2) | MIT | Group disabled; the other five keep working |
| 文档互转 (HTML) | [markdownify](https://github.com/matthewwithanm/python-markdownify) | MIT | HTML direction disabled; DOCX and Markdown directions are dependency-free |
| PDF 页面 | [pikepdf](https://github.com/pikepdf/pikepdf) | MPL-2.0 | Group disabled |
| 数字与拼音 | [pypinyin](https://github.com/mozillazg/python-pinyin) | MIT | Pinyin action disabled; amounts and numerals are dependency-free |
| 中文排版 (检测) | [charset-normalizer](https://github.com/jawah/charset_normalizer) | MIT | Falls back to an ordered decode probe (GB18030 wins ties) |

`text_normalize.py` (zhconv) is a hard dependency but degrades to a no-op when
the import fails, so a missing package never breaks translation.

`pdf_layout.py` exposes two extraction strategies. `plain` (the default) uses
pdfplumber's fast text pass; `layout` rebuilds each page from word coordinates so
two-column pages keep their reading order, at roughly 2.5x the CPU cost. The mode
comes from `TRANSLATION_PDF_LAYOUT_MODE` and is passed to `extract_paragraphs`.
Page text always runs through `_paragraphs_from_text` afterwards, which keeps the
segment count proportional to real paragraphs instead of visual lines.

Conversion endpoints hold whole files in memory, so they cap uploads at 40 MB
(`MAX_CONVERT_BYTES`) rather than the 80 MB streaming limit used by document
translation. Multi-output tools (subtitle split, PDF split) write a ZIP under
`output/converted/` and return a token URL instead of streaming several files.

## Local checks

```powershell
.\.venv\Scripts\python.exe -m compileall -q app tools
.\.venv\Scripts\python.exe -c "from app.main import app; print(app.title, app.version)"
.\.venv\Scripts\python.exe -m pytest tests -q
git diff --check
```

## CI/CD checks

`.github/workflows/ci.yml` runs on pushes and pull requests. It installs
`requirements.txt` plus pytest, compiles Python modules, runs `tests/`, checks
frontend JavaScript syntax, validates DOM ids and vendored assets, imports the
application and checks key routes, then runs `git diff --check`. A deployment
workflow can reuse this job and append packaging or release steps after it.
