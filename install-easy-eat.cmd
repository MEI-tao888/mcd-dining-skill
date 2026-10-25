@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-easy-eat.ps1" %*
set "RC=%ERRORLEVEL%"
echo.
if not "%RC%"=="0" (
  echo [FAIL] 安装未完成，退出码 %RC%
) else (
  echo [OK] 安装完成
)
echo 结果文件：%LOCALAPPDATA%\EasyEat\install-result.json
pause
exit /b %RC%
