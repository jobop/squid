# Journal des mises à jour

## 2026-04-10

### Ajouts

- Reconnaissance d’images entrantes par canal : Telegram / Feishu / WeChat (compte personnel) enregistrent les images exploitables dans le workspace et les injectent dans l’exécution via `mentions(file)`.
- Commande d’interruption canal : `/wtf`, acheminée vers la branche de commandes unifiée de `TaskAPI.executeTaskStream`.

### Changements de comportement

- `/wtf` aligné sur la touche Échap Web : interrompt uniquement la tâche en cours pour la session, sans vider la file d’attente.
- `/wtf` évalué avant le contrôle busy pour éviter qu’une session occupée bloque l’interruption immédiate.

### Vérification

- Régressions via `task-api-execute-stream-slash`, `telegram-squid-bridge`, `feishu-squid-bridge`, `weixin-personal-squid-bridge`.
