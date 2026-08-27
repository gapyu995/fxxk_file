"""FastAPI application factory and lifecycle wiring.

Keeping assembly here makes ``app.main`` a stable, tiny entry point for
Uvicorn, PyInstaller and CI smoke tests while route/service modules stay
independently testable.
"""

from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from app.api.routers import documents, system, translation
from app.core.runtime import active_tasks
from app.services.storage import STATIC, ensure_directories, finalize_and_clear_document_records


@asynccontextmanager
async def lifespan(_: FastAPI):
    ensure_directories()
    yield
    tasks = list(active_tasks.values())
    for task in tasks:
        task.cancel()
    if tasks:
        await asyncio.gather(*tasks, return_exceptions=True)
    active_tasks.clear()
    await asyncio.to_thread(finalize_and_clear_document_records)


def create_app() -> FastAPI:
    """Build the HTTP application with all routers and static resources."""
    application = FastAPI(title="fxxk_file", version="1.5.0", lifespan=lifespan)
    application.include_router(system.router)
    application.include_router(documents.router)
    application.include_router(translation.router)
    application.mount("/", StaticFiles(directory=STATIC, html=True), name="static")
    return application
