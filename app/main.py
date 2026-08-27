"""ASGI entry point used by local development and deployment runners."""

from app.application import create_app

# Backward-compatible imports for scripts that previously imported these
# request models/runtime values from ``app.main``.
from app.api.schemas import AutosaveRequest, SegmentUpdate, SettingsUpdate, TranslationRequest
from app.core.runtime import MAX_UPLOAD_BYTES, active_tasks

app = create_app()
