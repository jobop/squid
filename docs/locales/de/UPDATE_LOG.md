# Änderungsprotokoll

## 2026-04-10

### Neu

- Kanal-Inbound-Bilderkennung: Telegram / Feishu / WeChat Personal speichern erkennbare Bilder im Workspace und injizieren sie per `mentions(file)` in die Aufgabenausführung.
- Kanal-Abbruchbefehl: `/wtf` nutzt den einheitlichen Befehlzweig in `TaskAPI.executeTaskStream`.

### Verhaltensänderungen

- `/wtf` entspricht Web-ESC: nur die laufende Aufgabe der aktuellen Sitzung abbrechen, Warteschlange **nicht** leeren.
- `/wtf` wird vor der Busy-Prüfung ausgeführt, damit der Befehl bei „beschäftigt“ nicht wie eine normale Anfrage behandelt wird.

### Verifikation

- Regression über `task-api-execute-stream-slash`, `telegram-squid-bridge`, `feishu-squid-bridge`, `weixin-personal-squid-bridge`.
