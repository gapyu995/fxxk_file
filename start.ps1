$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

Set-Location $ProjectRoot

if (-not (Test-Path -LiteralPath $VenvPython)) {
    Write-Host "正在创建 Python 虚拟环境..." -ForegroundColor Cyan
    python -m venv .venv
}

Write-Host "正在检查依赖..." -ForegroundColor Cyan
& $VenvPython -m pip install -r requirements.txt

if (-not (Test-Path -LiteralPath ".env")) {
    Copy-Item -LiteralPath ".env.example" -Destination ".env"
}

Write-Host "浏览器地址：http://127.0.0.1:6670（可在 .env 中通过 APP_PORT 修改）" -ForegroundColor Green
& $VenvPython tools\linguabridge.py
