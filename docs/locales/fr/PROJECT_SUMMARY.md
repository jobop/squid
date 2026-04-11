# Vue d’ensemble du projet squid

Ce document résume la portée du dépôt et le découpage modulaire pour revue produit / technique ; en cas d’écart, le code source fait foi.

## Positionnement

squid : poste de travail IA de bureau orienté local (Electrobun + Bun + WebView système). Les données par défaut résident dans `~/.squid` sous le profil utilisateur.

## Capacités implémentées (résumé)

### Tâches et contexte

- Modèle de données des tâches et machine à états Ask / Craft / Plan  
- Compression de contexte et persistance des tâches  
- Permissions et classification des risques des outils  

### Modèles

- Adaptateurs et registre Anthropic, OpenAI, DeepSeek, etc. (`src/models`)  
- Flux de sortie, comptage de tokens, stockage chiffré des clés  

### Workspace et outils

- Liaison du répertoire de travail, bac à sable de chemins  
- ReadFile, WriteFile, Glob, Grep et mapping unifié des résultats d’outil avec limite de taille  

### Skills et experts

- YAML des skills, chargeur, liste blanche et hooks  
- Modèles de skills et d’experts intégrés ; certaines parties UI encore en évolution  

### Claw et planification

- Service HTTP Claw et traitement des tâches (`src/claw`) ; activation par défaut sur le bureau : voir `src/bun/index.ts`  
- Tâches planifiées node-cron, historique d’exécution, notifications mail (si configurées)  

### Canaux

- Registre des canaux, WebUI intégré  
- Canaux d’extension : `extensions/` + répertoire utilisateur, manifest déclaratif et pont TaskAPI  
- EventBridge, WebSocket et intégration UI (voir [webui-channel.md](./webui-channel.md), etc.)  

### Bureau et frontend

- Interface React principale, réglages, pages tâches / sessions  
- API HTTP locale (`Bun.serve` côté processus principal pour l’UI)  

### Qualité

- Tests unitaires et de type intégration Vitest (voir [TEST_REPORT.md](./TEST_REPORT.md))  
- Documentation utilisateur et développeur dans `docs/`  

## Tests et barrière qualité

Dernier archivage : 9 fichiers de test, 31 cas passés (voir TEST_REPORT). Avant fusion, exécuter `npm test` en local.

## Sécurité (résumé)

- Bac à sable de chemins et marqueurs lecture seule / destructif des outils  
- Protection locale des clés (AES-256-GCM selon `secure-storage`)  
- Jeton Claw et moteur de permissions (si les chemins correspondants sont activés)  

## Performance (résumé)

- LRU, défilement virtuel, chargement paresseux, réponses en flux, compression de contexte (selon les modules concernés)  

## Documentation

| Document | Usage |
|----------|--------|
| [QUICK_START.md](./QUICK_START.md) | Démarrage rapide utilisateur |
| [user-guide.md](./user-guide.md) | Description fonctionnelle |
| [developer-guide.md](./developer-guide.md) | Architecture et extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Normes de développement d’outils |
| [TEST_REPORT.md](./TEST_REPORT.md) | Rapport de tests |

## Version

Le numéro de version du dépôt est dans `package.json` ; les notes de version : [RELEASE_NOTES.md](./RELEASE_NOTES.md).
