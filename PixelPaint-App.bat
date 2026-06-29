@echo off
chcp 65001 >nul 2>&1
pushd "%~dp0"
REM ============================================================
REM PixelPaint-App.bat
REM Serves PixelPaint on http://localhost:8137 so Chrome/Edge can
REM install it as a desktop app, then opens it in your browser.
REM (Installing a PWA needs a real http origin -- a double-clicked
REM  file:// page can't be installed.)
REM Prefers Node.js, falls back to Python.
REM ============================================================

where node >nul 2>&1
if %ERRORLEVEL%==0 (
    node "%~dp0server.js"
    goto end
)

where py >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" "http://localhost:8137/PixelPaint.html"
    py -m http.server 8137
    goto end
)

where python >nul 2>&1
if %ERRORLEVEL%==0 (
    start "" "http://localhost:8137/PixelPaint.html"
    python -m http.server 8137
    goto end
)

powershell -NoProfile -Command "Write-Host 'Node.js or Python is required to run PixelPaint as an installable app.' -ForegroundColor Yellow; Write-Host 'You can still open PixelPaint.html directly in your browser (install option will not appear).' -ForegroundColor DarkGray"
pause

:end
popd
