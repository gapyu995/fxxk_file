from __future__ import annotations

import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import uvicorn

from app.config import get_settings


if __name__ == "__main__":
    settings = get_settings()
    print(f"\nTranslator 已启动：http://{settings.host}:{settings.port}\n")
    uvicorn.run("app.main:app", host=settings.host, port=settings.port, reload=False)
