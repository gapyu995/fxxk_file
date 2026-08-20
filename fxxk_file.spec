# -*- mode: python ; coding: utf-8 -*-

from PyInstaller.utils.hooks import collect_all

datas = []
binaries = []
hiddenimports = []

# pywebview: platform backends, WebView2 loader DLLs and JS API files.
wv_datas, wv_binaries, wv_hidden = collect_all("webview")
datas += wv_datas
binaries += wv_binaries
hiddenimports += wv_hidden

# Web UI (served by FastAPI StaticFiles at runtime).
datas += [("app/static", "app/static")]

# FastAPI/Starlette import python-multipart lazily; make it explicit.
hiddenimports += ["multipart", "multipart.multipart"]

a = Analysis(
    ["tools/desktop.py"],
    pathex=["."],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=["tkinter", "matplotlib", "numpy", "IPython", "pandas"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="fxxk_file",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=False,
    icon="assets/app.ico",
)

coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name="fxxk_file",
)
