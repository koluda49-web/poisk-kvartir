@echo off
chcp 65001 >nul
cd /d "%~dp0"
title Поиск квартир на сутки
start "" /b node kvartiry-server.js
timeout /t 2 >nul
start "" http://localhost:8080
echo Поиск открыт в браузере. Это окно можно свернуть.
echo Чтобы остановить - закройте это окно.
pause >nul
