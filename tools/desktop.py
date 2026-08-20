from __future__ import annotations

import os
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

        ctypes.windll.user32.MessageBoxW(0, message, "fxxk_file", 0x10)
    except Exception:
        print(message, file=sys.stderr)


def port_is_open(host: str, port: int) -> bool:
    try:
        with socket.create_connection((host, port), timeout=0.5):
            return True
    except OSError:
        return False


def _patch_download_directory(download_dir: str) -> None:
    """Default pywebview's save-as dialog to ``download_dir``.

    Falls back to the user's Downloads folder when the configured directory does
    not exist (for example on a machine without a D: drive).
    """
    try:
        import winreg

        from webview.platforms import edgechromium
    except Exception:
        return  # non-Windows backend or unavailable; keep pywebview defaults

    downloads_guid = "{374DE290-123F-4565-9164-39C4925E467B}"

    def _default_directory() -> str:
        candidate = download_dir.strip()
        if candidate and Path(candidate).is_dir():
            return candidate
        try:
            with winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                r"Software\Microsoft\Windows\CurrentVersion\Explorer\Shell Folders",
            ) as key:
                return winreg.QueryValueEx(key, downloads_guid)[0]
        except Exception:
            return ""

    def on_download_starting(self, sender, args):
        if not webview.settings.get("ALLOW_DOWNLOADS", False):
            args.Cancel = True
            return
        dialog = edgechromium.WinForms.SaveFileDialog()
        initial = _default_directory()
        if initial:
            dialog.InitialDirectory = initial
        dialog.Filter = self.pywebview_window.localization["windows.fileFilter.allFiles"] + " (*.*)|*.*"
        dialog.RestoreDirectory = True
        dialog.FileName = os.path.basename(args.ResultFilePath)
        result = dialog.ShowDialog(self.form)
        if result == edgechromium.WinForms.DialogResult.OK:
            args.ResultFilePath = dialog.FileName
        else:
            args.Cancel = True

    edgechromium.EdgeChrome.on_download_starting = on_download_starting


def main() -> None:
    settings = get_settings()
    _patch_download_directory(settings.download_dir)
    if port_is_open(settings.host, settings.port):
        show_error(
            f"端口 {settings.port} 已被占用。\n\n"
            "请先关闭已运行的 fxxk_file 或修改 .env 中的 APP_PORT。"
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
    thread = threading.Thread(target=server.run, name="fxxk_file-server")
    thread.start()
    deadline = time.monotonic() + 12
    while not server.started and thread.is_alive() and time.monotonic() < deadline:
        time.sleep(0.05)
    if not server.started:
        server.should_exit = True
        thread.join(timeout=3)
        show_error("fxxk_file 本地服务启动失败，请查看项目配置或改用 start.ps1 启动。")
        return

    url = f"http://{settings.host}:{settings.port}"
    try:
        # Downloads are disabled by default in pywebview. Enabling them makes
        # the translated-DOCX link open the native Windows Save dialog.
        webview.settings["ALLOW_DOWNLOADS"] = True
        webview.create_window(
            "fxxk_file · 原文件与译文对照",
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
