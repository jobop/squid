# Notes de version squid v0.1.0

## Dernières mises à jour (2026-04-10)

### Chaîne de reconnaissance d’images pour les canaux

- Telegram / Feishu / WeChat (compte personnel) : images entrantes unifiées via « téléchargement dans le workspace + `mentions(file)` ».
- En cas de file d’attente canal saturée, le même `mentions` est conservé pour éviter la perte d’images sur le chemin file.
- Nouvelle capacité partagée côté extension : `extensions/shared/workspace-image-store.ts`.

### Commande d’interruption canal `/wtf`

- Ajout de `/wtf` dans `TaskAPI.executeTaskStream`, sémantique alignée sur la touche Échap Web : interrompt uniquement la tâche en cours pour la session, sans vider la file.
- La branche `/wtf` est évaluée avant le contrôle « session occupée », afin qu’une interruption immédiate soit possible même quand la session est marquée busy.
- Les tests de pont Telegram / Feishu / WeChat vérifient que `/wtf` atteint la branche de commande unifiée.

## Vue d’ensemble

Première version publique de squid : poste de travail IA de bureau local basé sur Electrobun, avec dialogue multi-modèles, modes de tâche, skills et experts, planification et canaux extensibles (Feishu / Telegram / WeChat, etc., activables au besoin).

## Capacités principales

### Tâches et workspace

- Modes Ask (plutôt lecture seule), Craft (outils automatiques), Plan (planification et confirmation)
- Machine à états des tâches et persistance
- Répertoire de travail lié et bac à sable de chemins

### Modèles

- Série Claude Anthropic (modèles disponibles selon les réglages)
- API compatible OpenAI
- Points de terminaison compatibles type DeepSeek (selon adaptateurs et réglages)
- Sortie en flux et comptage de tokens (selon l’implémentation réelle)
- Stockage local chiffré des clés API

### Skills et experts

- Modèles de skills intégrés ; chargement depuis `~/.squid/skills` et installation depuis SkillHub, etc.
- Plusieurs experts intégrés et points d’extension personnalisés

### Canaux

- Canal WebUI intégré
- Canaux d’extension : `extensions/` et `~/.squid/extensions`, configuration déclarative et pont vers TaskAPI

### Claw et automatisation

- Capacités HTTP et conception de jetons Claw : voir `src/claw` ; l’activation par défaut du service Claw sur l’entrée bureau suit `src/bun/index.ts`
- Tâches planifiées basées sur node-cron et historique d’exécution

### Shell bureau

- Electrobun : processus principal Bun + WebView système
- Mise en page principale, réglages, UI tâches et sessions

## Tests

Dernier lot automatisé enregistré : 9 fichiers de test, 31 cas passés (voir [TEST_REPORT.md](./TEST_REPORT.md)). Avant publication, exécutez `npm test` sur l’environnement cible.

## Installation et commandes (sources)

```bash
git clone <repository-url>
cd squid
npm install
npm test          # optionnel
npm run dev       # développement bureau
npm run build     # tsc
npm run build:electron:release   # chaîne stable bureau (sortie artifacts/)
```

## Configuration

Premier lancement : renseignez les clés de modèle dans **Réglages** et enregistrez. Canaux et Feishu : [QUICK_START.md](./QUICK_START.md), [channel-extensions.md](./channel-extensions.md).

**Remarque build** : Electrobun **ne lit que `electrobun.config.ts`** ; sans ce fichier ou avec une erreur `.js`, le paquet stable peut ne pas copier `public`, ce qui provoque un écran blanc.

## Index documentaire

- [user-guide.md](./user-guide.md)
- [developer-guide.md](./developer-guide.md)
- [TEST_REPORT.md](./TEST_REPORT.md)
- [PROJECT_SUMMARY.md](./PROJECT_SUMMARY.md)

## Sécurité

- Validation des chemins workspace et classification des permissions d’outils
- Stockage chiffré des clés en local
- Le service HTTP local ne doit pas être exposé à Internet sans durcissement

## Limites connues

- Certaines parties de l’UI et des sélecteurs évoluent encore (suivre les issues et jalons)
- Les builds macOS non signés / non notarisés peuvent déclencher Gatekeeper ; pour la distribution, privilégier signature Developer ID et notarisation

## Orientations futures (plan)

- Enrichir l’écosystème skills / canaux, les réglages et l’observabilité
- Performance et expérience utilisateur

## Licence

MIT License

---

**Date de publication** : 2026-04-04 (maintenu avec le dépôt)  
**Version** : v0.1.0  
**Statut** : en maintenance
