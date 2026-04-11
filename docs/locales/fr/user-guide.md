# Guide utilisateur squid

Ce document décrit les principales capacités et le mode d’emploi du client bureau squid ; en cas d’écart avec le code ou les tests, la version installée et l’interface font foi.

## Installation et démarrage

**Depuis les sources**

```bash
cd squid
npm install
npm run dev
```

**Remarque** : `npm run build` compile TypeScript ; `npm start` lance `node dist/main.js`, ce qui diffère du flux bureau Electrobun. Pour le bureau au quotidien, utilisez `npm run dev`.

**Paquets publiés**  
Installez ou exécutez selon la plateforme ; sur macOS, voir le [README.md](./README.md) du dépôt pour Gatekeeper et attributs étendus.

## Réglages

Premier usage :

1. Ouvrir **Réglages** dans la barre latérale.  
2. Configurer **Anthropic / OpenAI / point compatible** : clés, modèle, URL de base si applicable.  
3. Enregistrer ; la configuration est écrite dans `~/.squid/config.json`.

Options facultatives : canaux, préférences d’interface (selon les sections réelles des réglages).

## Tâches et sessions

### Modes de tâche

| Mode | Usage typique |
|------|----------------|
| Ask | Questions, analyse en lecture seule, peu de modifications des fichiers du workspace |
| Craft | Exécution automatique d’outils, création ou modification possible de fichiers dans le workspace |
| Plan | Tâches complexes : plan ou étapes avant exécution confirmée |

### Création (aperçu)

1. Choisir **Nouvelle tâche** ou l’entrée équivalente.  
2. Sélectionner le mode, le modèle et le **répertoire de travail** (obligatoire, de confiance).  
3. Facultatif : skill, expert.  
4. Saisir la consigne en langage naturel et valider.

Les chemins hors du répertoire de travail sont en principe rejetés par le bac à sable ; n’utilisez pas de répertoires système sensibles comme racine de workspace.

## Skills

- Skills prédéfinis et installés sélectionnables lors de la création de tâche ou dans les réglages.  
- Contenu sous `~/.squid/skills/` (fichiers ou arborescence selon le chargeur).  
- Installation et métadonnées Tencent SkillHub : [tencent-skillhub.md](./tencent-skillhub.md).  

## Experts

Plusieurs rôles intégrés pour ajuster le style et le périmètre ; centre d’experts pour consultation et changement. Les experts personnalisés dépendent de la version courante.

## Tâches planifiées

1. Page **Tâches planifiées**.  
2. Nouvelle entrée : expression Cron, contenu transmis au modèle, autres options.  
3. Actif seulement tant que **l’application tourne** ; à la fermeture, la planification s’arrête.

Des modèles prédéfinis (résumé quotidien, inspection de dépôt, etc.) peuvent être proposés dans l’assistant de création.

## Canaux (Channel)

- **WebUI** : chat et tâches principaux, canal intégré vers le moteur.  
- **Extensions** : Feishu, Telegram, compte WeChat personnel, etc., sous `extensions/` et `~/.squid/extensions/`, déclarés par `channel-plugin.json` ; activation et formulaires : [channel-extensions.md](./channel-extensions.md).  

Côté Feishu : application plateforme ouverte, abonnements d’événements (longue connexion ou webhook), fichier local `~/.squid/feishu-channel.json` ; en mode HTTP, l’URL d’événement doit joindre la machine : voir [QUICK_START.md](./QUICK_START.md) et la documentation sous `extensions/feishu`.

## Mémoire

La mémoire long terme dispose d’un écran dédié ; l’emplacement exact sous `~/.squid` suit l’implémentation. En test, des variables d’environnement peuvent rediriger le répertoire (voir la doc développeur).

## Claw et API locale (avancé)

- **API HTTP locale** intégrée au client bureau (communication avec l’UI sur la même machine) pour exécution de tâches et flux ; ne pas exposer sans durcissement.  
- Implémentation Claw sous `src/claw` ; activation par défaut au démarrage bureau : suivre `src/bun/index.ts`. Appels distants, jetons et routage : code et tests.

## Données et sauvegarde

| Chemin | Contenu |
|--------|---------|
| `~/.squid/config.json` | Configuration principale et clés modèle |
| `~/.squid/skills/` | Skills |
| `~/.squid/channel-extensions.json` | Activation des extensions côté utilisateur |
| `~/.squid/extensions/` | Racine d’extensions utilisateur |

Sauvegardez régulièrement `~/.squid` ; ne versionnez pas les secrets.

## FAQ

**Changer le modèle par défaut ?**  
Dans les réglages ou en surcharge lors de la création d’une tâche.

**Lire des fichiers hors workspace ?**  
Non par défaut ; dépend du bac à sable et des règles de permission.

**Désinstaller ou migrer ?**  
Quitter l’application, sauvegarder ou supprimer `~/.squid` ; sur une nouvelle machine, restaurer ce dossier et réinstaller l’application.

## Documents associés

- [QUICK_START.md](./QUICK_START.md) — mise en route minimale  
- [developer-guide.md](./developer-guide.md) — développement et extensions  
- [tool-development-guide.md](./tool-development-guide.md) — normes des outils  
- [TEST_REPORT.md](./TEST_REPORT.md) — rapport de tests  
