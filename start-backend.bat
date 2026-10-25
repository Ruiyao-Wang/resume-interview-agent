@echo off
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" (
  python -m venv .venv
  if errorlevel 1 goto failed
)
".venv\Scripts\python.exe" -c "import fastapi, uvicorn, pypdf, multipart, httpx, dotenv" >nul 2>&1
if errorlevel 1 (
  ".venv\Scripts\python.exe" -m pip install -r requirements.lock
  if errorlevel 1 goto failed
)
start "" powershell -NoProfile -WindowStyle Hidden -Command "for ($attempt=0; $attempt -lt 30; $attempt++) { try { $reply=Invoke-RestMethod 'http://127.0.0.1:8765/api/health'; if ($reply.ok -and $reply.version -eq '1.0.0') { Start-Process 'http://127.0.0.1:8765/interview'; break } } catch { Write-Verbose $_.Exception.GetType().Name }; Start-Sleep -Seconds 1 }"
echo Local material library: http://127.0.0.1:8765
echo Interview Agent: http://127.0.0.1:8765/interview
echo Keep this window open. Close it to stop the server.
".venv\Scripts\python.exe" -m uvicorn app:app --host 127.0.0.1 --port 8765
if errorlevel 1 goto failed
exit /b 0
:failed
echo Could not start. Check Python 3.11, your network, and whether port 8765 is in use.
pause
exit /b 1
