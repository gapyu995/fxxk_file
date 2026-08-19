@echo off
setlocal
cd /d "%~dp0"

if exist ".venv\Scripts\python.exe" goto check
echo Creating the Python environment. Please wait...
python -m venv ".venv"
if errorlevel 1 goto error

:check
".venv\Scripts\python.exe" -c "import fastapi, webview" >nul 2>&1
if not errorlevel 1 goto launch
echo Installing required components. Please wait...
".venv\Scripts\python.exe" -m pip install -r "requirements.txt"
if errorlevel 1 goto error

:launch
start "LinguaBridge" /D "%CD%" ".venv\Scripts\pythonw.exe" "tools\desktop.py"
exit /b 0

:error
echo.
echo LinguaBridge could not start. Check Python and the network connection.
pause
exit /b 1
