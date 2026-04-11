# Befehlswarteschlange (an claude-code-main angeglichen)

## Verhalten (Kurz)

- **Eimer pro `conversationId`**: Innerhalb einer Konversation Reihenfolge und Priorität (`now` > `next` > `later`); andere Konversationen blockieren sich nicht gegenseitig.
- **Direktausführung bei Leerlauf**: `TaskAPI.executeTask` / `executeTaskStream` laufen durch, wenn die Sitzung frei ist.
- **Bei Beschäftigung einreihen**: Läuft in derselben Sitzung bereits etwas, führt der neue Aufruf über `TaskAPIConversationBusyError` (Streaming) bzw. `executeTask` mit `queued: true` (nicht-streaming HTTP 202) in die Warteschlange; `enqueueFromRequest` triggert `scheduleDrain`.
- **Verkettetes Drain**: Jede Ausführung ruft im `finally` `processConversationQueueIfReady` auf und leert so die Sitzungswarteschlange.

## HTTP

- `POST /api/task/execute`: bei Einreihen **HTTP 202**, Body mit `queued`, `queuePosition`, `conversationId`.
- `POST /api/task/execute-stream`: bei Einreihen weiterhin **200 + SSE**, erstes `data`-JSON mit `queued: true`, `queuePosition`, `conversationId`, `message`; danach `[DONE]`. Frontend: `public/index.html` und Verarbeitung von `parsed.queued`.

## Cron

- Trigger nur noch `enqueuePendingNotification` mit `conversationId = cron:<taskId>`; `cronManager.setEnqueueDrainNotifier` ruft `taskAPI.kickConversationQueueDrain` auf – **kein** direktes `executeTask` mehr im Cron-Pfad.

## Externe Kanäle (Feishu / Telegram / weitere Erweiterungen)

- Bei beschäftigter Sitzung kann `enqueueFromRequest`-Meta **`channelReply: { channelId, chatId }`** enthalten (Kernfelder, keine kanalspezifischen `QueuedCommand`-Erweiterungen mehr).
- Nach Abschluss der Warteschlange broadcastet TaskAPI an alle per **`addChannelQueuedCompleteHandler`** registrierten Callbacks; Kanal-Brücken prüfen `cmd.channelReply?.channelId === '<id>'` vor dem Zurücksenden.
- **Kompatibilität**: Meta unterstützt weiterhin veraltetes `feishuChatId` (Äquivalent zu `channelReply: { channelId: 'feishu', chatId }`).

## Kanal-Abbruchbefehl (`/wtf`)

- `/wtf` wird zentral in `TaskAPI.executeTaskStream` behandelt (keine doppelte Implementierung pro Kanal).
- Wie Web-ESC: nur `abortConversation(conversationId)` für die laufende Aufgabe, Warteschlange bleibt.
- Prüfung vor der Busy-Logik, damit ein sofortiger Abbruch auch während laufender Ausführung möglich ist.

## Feishu

- Brücke nutzt `channelId: 'feishu'` wie oben beschrieben.
