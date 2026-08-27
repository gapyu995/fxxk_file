"""Process-wide runtime state shared by API routers and the app lifecycle."""

from __future__ import annotations

import asyncio

MAX_UPLOAD_BYTES = 80 * 1024 * 1024

# A document can have at most one active translation task.  Keeping this in a
# small dedicated module prevents routers from importing the FastAPI app.
active_tasks: dict[str, asyncio.Task] = {}
