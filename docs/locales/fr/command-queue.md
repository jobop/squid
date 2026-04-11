# File de commandes (alignée sur claude-code-main)

## Résumé du comportement

- **Partitionnement par `conversationId`** : files et priorités (`now` > `next` > `later`) au sein d’une même conversation ; les conversations distinctes ne se bloquent pas mutuellement.
- **Exécution directe si libre** : `TaskAPI.executeTask` / `executeTaskStream` s’exécutent directement lorsque la session n’est pas occupée.
- **Mise en file si occupé** : lorsqu’une exécution est déjà en cours pour la session, les nouvelles requêtes passent par `TaskAPIConversationBusyError` (flux) ou `executeTask` renvoie `queued: true` (hors flux, HTTP 202) ; `enqueueFromRequest` déclenche `scheduleDrain`.
- **Vidage en chaîne** : chaque exécution appelle dans `finally` `processConversationQueueIfReady`, ce qui vide la file de la conversation.

## HTTP

- `POST /api/task/execute` : si mis en file, **HTTP 202** avec un corps contenant `queued`, `queuePosition`, `conversationId`.
- `POST /api/task/execute-stream` : en cas de file, toujours **200 + SSE** ; le premier fragment JSON contient `queued: true`, `queuePosition`, `conversationId`, `message` ; puis `[DONE]`. Côté frontend, voir `public/index.html` pour la gestion de `parsed.queued`.

## Cron

- À l’heure du déclenchement, seule l’appel à `enqueuePendingNotification` avec `conversationId = cron:<taskId>` ; `cronManager.setEnqueueDrainNotifier` appelle `taskAPI.kickConversationQueueDrain` pour lancer le drain ; **plus** d’appel direct à `executeTask` depuis le cron.

## Canaux externes (Feishu / Telegram / extensions futures)

- En session occupée, le meta de `enqueueFromRequest` peut inclure **`channelReply: { channelId, chatId }`** (champs cœur ; n’étendez plus `QueuedCommand` par canal).
- Une fois la file exécutée, TaskAPI notifie tous les gestionnaires **`addChannelQueuedCompleteHandler`** ; chaque pont de canal vérifie `cmd.channelReply?.channelId === '<id>'` avant renvoi.
- **Compatibilité** : le meta accepte encore l’ancien `feishuChatId` (équivalent à `channelReply: { channelId: 'feishu', chatId }`).

## Commande d’interruption canal (`/wtf`)

- `/wtf` est traité dans `TaskAPI.executeTaskStream` (pas besoin d’une branche d’interruption par canal).
- Sémantique alignée sur la touche Échap Web : appelle seulement `abortConversation(conversationId)` pour la tâche en cours, **sans** vider la file.
- Le contrôle `/wtf` précède le test busy : une session « en cours d’exécution » peut être interrompue immédiatement sans être rejetée comme busy.

## Feishu

- Le pont utilise `channelId: 'feishu'` avec le mécanisme générique ci-dessus.
