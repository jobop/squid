# Coda comandi (allineata a claude-code-main)

## Sintesi comportamento

- **Raggruppamento per `conversationId`**: code e priorità (`now` > `next` > `later`) sono per conversazione; conversazioni diverse non si bloccano a vicenda.
- **Esecuzione diretta se libero**: `TaskAPI.executeTask` / `executeTaskStream` eseguono subito se la sessione non è occupata.
- **In coda se occupato**: con un’esecuzione già in corso per la sessione, le nuove richieste entrano in coda tramite `TaskAPIConversationBusyError` (streaming) oppure `executeTask` restituisce `queued: true` (non streaming, HTTP 202); `enqueueFromRequest` attiva `scheduleDrain`.
- **Drain a catena**: ogni esecuzione in `finally` chiama `processConversationQueueIfReady` per svuotare la coda della conversazione.

## HTTP

- `POST /api/task/execute`: se accodata, **HTTP 202** con body `queued`, `queuePosition`, `conversationId`.
- `POST /api/task/execute-stream`: se accodata, resta **200 + SSE**; il primo evento `data` JSON contiene `queued: true`, `queuePosition`, `conversationId`, `message`; poi `[DONE]`. Il frontend in `public/index.html` gestisce `parsed.queued`.

## Cron

- All’attivazione si usa solo `enqueuePendingNotification` verso `conversationId = cron:<taskId>`; `cronManager.setEnqueueDrainNotifier` chiama `taskAPI.kickConversationQueueDrain` per avviare il drain; **non** si invoca più `executeTask` direttamente dal cron.

## Canali esterni (Feishu / Telegram / estensioni future)

- Con sessione occupata, la meta di `enqueueFromRequest` può includere **`channelReply: { channelId, chatId }`** (campo core; non aggiungere campi `xxxChatId` dedicati al singolo canale nel core).
- A completamento coda, TaskAPI notifica tutti i callback registrati con **`addChannelQueuedCompleteHandler`**; ogni bridge canale verifica `cmd.channelReply?.channelId === '<id>'` prima di inviare la risposta.
- **Compatibilità**: la meta supporta ancora `feishuChatId` deprecato (equivalente a `channelReply: { channelId: 'feishu', chatId }`).

## Comando di interruzione canale (`/wtf`)

- `/wtf` è gestito in modo unificato in `TaskAPI.executeTaskStream` (nessun ramo di interruzione per canale).
- Stessa semantica del tasto ESC nel Web: chiama `abortConversation(conversationId)` per l’attività in esecuzione, **senza** rimuovere gli elementi in coda.
- Il controllo `/wtf` avviene **prima** del busy check, così durante l’esecuzione l’interruzione è immediata e non viene mascherata da busy.

## Feishu

- Il bridge usa `channelId: 'feishu'` con lo stesso meccanismo generico sopra.
