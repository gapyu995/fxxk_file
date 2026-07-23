from __future__ import annotations

import socket
import sys
import threading
import time
from pathlib import Path

import uvicorn
import webview


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import get_settings


def show_error(message: str) -> None:
    try:
        import ctypes

        ctypes.windll.user32.MessageBoxW(0, message, "Chanslator", 0x10)
    except Exception:
        print(message, file=sys.stderr)


def port_is_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def main() -> None:
    settings = get_settings()
    if port_is_open(settings.host, settings.port):
        show_error(
            f"端口 {settings.port} 已被占用。\n\n"
            "请先关闭已运行的 Chanslator 或修改 .env 中的 APP_PORT。"
        )
        return

    config = uvicorn.Config(
        "app.main:app",
        host=settings.host,
        port=settings.port,
        log_level="warning",
        access_log=False,
    )
    server = uvicorn.Server(config)
    thread = threading.Thread(target=server.run, name="chanslator-server")
    thread.start()
    deadline = time.monotonic() + 12
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=3)
        show_error("Chanslator 本地服务启动失败，请查看项目配置或改用 start.ps1 启动。")
        return

    url = f"http://{settings.host}:{settings.port}"
    try:
        # Downloads are disabled by default in pywebview. Enabling them makes
        # the translated-DOCX link open the native Windows Save dialog.
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.create_window(
            "Chanslator · 原文件与译文对照",
            url,
            width=1500,
            height=920,
            min_size=(1000, 650),
            confirm_close=False,
        )
        webview.start(debug=False, private_mode=True)
    except Exception as exc:
        show_error(f"无法打开审校窗口：{exc}")
    finally:
        server.should_exit = True
        thread.join(timeout=12)


if __name__ == "__main__":
    main()
