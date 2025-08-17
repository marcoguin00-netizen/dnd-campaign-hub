@echo off
REM Avvia server in una nuova finestra
start "DND Server" cmd /k ^
  "cd /d ""C:\Users\marco\OneDrive\Desktop\APP campagna\dnd-campaign-hub-rt\dnd-campaign-hub-rt"" && npm run server"

REM Aspetta un attimo e avvia il client in un’altra finestra
timeout /t 2 >nul
start "DND Client" cmd /k ^
  "cd /d ""C:\Users\marco\OneDrive\Desktop\APP campagna\dnd-campaign-hub-rt\dnd-campaign-hub-rt"" && npm run dev"
