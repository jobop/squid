# Registro aggiornamenti

## 2026-04-10

### Novità

- Riconoscimento immagini in ingresso dai canali: Telegram, Feishu e WeChat personale salvano le immagini riconoscibili nel workspace e le iniettano nell’esecuzione tramite `mentions(file)`.
- Comando di interruzione canale: aggiunto `/wtf`, instradato nel ramo comandi di `TaskAPI.executeTaskStream` per l’interruzione.

### Modifiche di comportamento

- `/wtf` allineato al tasto ESC del Web: interrompe solo l’attività in esecuzione per la sessione corrente, senza svuotare la coda.
- `/wtf` valutato **prima** del controllo «sessione occupata», così l’interruzione è immediata anche quando la sessione è busy e non viene trattata come richiesta normale.

### Verifica

- Regressioni: `task-api-execute-stream-slash`, `telegram-squid-bridge`, `feishu-squid-bridge`, `weixin-personal-squid-bridge`.
