@echo off
chcp 65001 > nul
title Liminal Campervan Bar - POS Server

echo ========================================================
echo   LIMINAL CAMPERVAN BAR - SISTEM KASIR POS
echo ========================================================
echo.

set "MYSQL_DIR=%LOCALAPPDATA%\campervan-mysql-dev"
set "MYSQLD_EXE=C:\Program Files\MySQL\MySQL Server 8.0\bin\mysqld.exe"

netstat -ano | findstr ":3307 " | findstr "LISTENING" > nul
if %errorlevel% neq 0 (
    echo [1/2] Menyalakan database MySQL lokal di port 3307...
    start "" /B "%MYSQLD_EXE%" --no-defaults --datadir="%MYSQL_DIR%\data" --port=3307 --mysqlx=0 --log-error="%MYSQL_DIR%\error.log"
    timeout /t 3 /nobreak > nul
) else (
    echo [1/2] Database MySQL lokal sudah aktif di port 3307.
)

cd /d "%~dp0"
echo [2/2] Menjalankan server aplikasi di http://localhost:3000 ...
echo.
echo   Login Kasir : kasir / kasir123
echo   Login Admin : admin / admin123
echo.
start "" "http://localhost:3000/pos"
call npm.cmd run start -- -H 0.0.0.0 -p 3000
pause
