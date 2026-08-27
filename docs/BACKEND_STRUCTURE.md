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
│       └── translation.py      # segment editing, autosave and translation
├── core/
│   └── runtime.py              # upload limit and active task registry
└── services/
    ├── preview.py              # DOCX/PDF browser preview pages
    └── translation_job.py      # batching, retry, progress and background jobs
```

## Module boundaries

- `api/routers` handles HTTP parameters, status codes and responses. It does
  not assemble the FastAPI application.
- `services` contains document and translation business logic and can be
  tested without an HTTP request.
- `core/runtime.py` is the single source of process-level task state. Routers
  must not import `app.main` to share state.
- Existing API paths and response fields remain compatible. New endpoints
  should be added to the matching router with a schema when appropriate.

## Local checks

```powershell
.\.venv\Scripts\python.exe -m compileall -q app tools
.\.venv\Scripts\python.exe -c "from app.main import app; print(app.title, app.version)"
git diff --check
```

## CI/CD checks

`.github/workflows/ci.yml` runs on pushes and pull requests. It installs
`requirements.txt`, compiles Python modules, imports the application and
checks key routes, then runs `git diff --check`. A deployment workflow can
reuse this job and append packaging or release steps after it.
