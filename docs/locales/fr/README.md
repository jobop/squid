# squid

squid est un poste de travail IA de bureau exécuté en local : dialogue avec le modèle dans une fenêtre d’application, gestion de plusieurs sessions, répertoire de travail par session, et prise en charge d’Anthropic, OpenAI ou d’API compatibles dans les réglages. Compétences (skills), mémoire, tâches planifiées ainsi que des canaux tels que Feishu, Telegram ou WeChat (à activer et configurer dans l’application) s’inscrivent dans une même chaîne de traitement des tâches. Vos réglages et données sont en principe stockés localement dans **`~/.squid`** sous le profil utilisateur.

**Version** : 0.1.0  
**Licence** : MIT

---

## Ce que vous pouvez faire

- **Chat multi-sessions** : conversations organisées par fil, avec répertoire de travail lié à la session pour poser des questions ou laisser l’assistant lire et écrire des fichiers dans les limites autorisées.
- **Modes de tâche** : dans l’interface, choisissez **Ask** (consultation et analyse en lecture seule), **Craft** (exécution d’outils) ou **Plan** (planification et découpage) selon l’objectif ; le comportement exact suit les indications dans l’application.
- **Modèles et clés** : dans **Réglages**, renseignez la clé API, le nom du modèle et l’URL de base personnalisée ; les secrets restent sur la machine et ne sont pas distribués avec le dépôt.
- **Skills** : parcourir, installer et gérer les skills depuis l’application (y compris depuis Tencent SkillHub) ; le contenu installé se trouve dans `~/.squid/skills`.
- **Experts et mémoire** : experts prédéfinis ou personnalisés pour le style et les limites de l’assistant ; mémoire long terme consultable et maintenable séparément.
- **Tâches planifiées** : déclenchement local selon une expression Cron, envoi du contenu défini au modèle, avec historique d’exécution.
- **Canaux** : en plus de l’interface principale, extensions Feishu, Telegram, compte WeChat personnel, etc. (configuration dans les réglages des canaux ; certains nécessitent une connexion supplémentaire ou un webhook ; voir `docs` et la doc de chaque canal).

---

## Installation et démarrage

**Exécution depuis les sources (développeurs ou build maison)**

- **Node.js** (22 LTS recommandé) et **npm** ; le shell bureau repose sur **Electrobun**, pris en charge sur macOS 14+, Windows 11+ et les environnements Linux indiqués dans la documentation officielle.
- Après clonage du dépôt, à la racine du projet :

```bash
cd squid
npm install
npm run dev
```

**Paquets publiés**

- Si des artefacts GitHub Release (ou équivalent) sont fournis, installez ou décompressez selon la plateforme ; sur macOS, une application non signée / non notarisée peut être bloquée au premier lancement : utilisez « Confidentialité et sécurité » pour autoriser si nécessaire.

---

## Premiers pas recommandés

1. Ouvrez **Réglages**, configurez le modèle et, si besoin, les canaux, puis enregistrez.  
2. Dans la zone de chat, **choisissez le répertoire de travail** (évitez les chemins non fiables comme racine de workspace).  
3. **Créez une session** et testez avec une demande courte ; ajoutez skills, planification ou canaux lorsque vous avez besoin d’automatisation.

Pour le détail de l’interface et des flux, voir **[QUICK_START.md](./QUICK_START.md)** et **[user-guide.md](./user-guide.md)**.  
Pour d’autres langues (zh/en/ja/ru/it/de), ouvrez **[docs/index.html](../../index.html)** et changez de locale.

---

## Où sont stockées les données

| Emplacement | Signification pour l’utilisateur |
|-------------|----------------------------------|
| `~/.squid/config.json` | Configuration principale : clés de modèle, options d’interface et interrupteurs de fonctionnalités |
| `~/.squid/skills/` | Fichiers des skills installés |
| Autres JSON sous `~/.squid` | Configuration et données propres aux extensions de canaux, à la mémoire, etc. (créés à l’usage) |

Sauvegardez ce répertoire vous-même ; n’y commitez pas de secrets. Pour certaines extensions (ex. WeChat personnel), une commande du type **`npm run weixin-personal:login`** peut être nécessaire depuis le dépôt sources ; suivez la documentation de l’extension.

---

## Sécurité

- Lorsque l’assistant dispose d’outils fichiers ou shell, la portée est contrainte par le **répertoire de travail** et les règles intégrées ; n’utilisez pas de répertoires système sensibles comme workspace par défaut.  
- L’application expose un service local pour la communication interface / processus principal ; en usage normal il n’est pas ouvert volontairement au LAN ou à Internet ; si vous faites du port forwarding ou un reverse proxy, sécurisez l’accès vous-même.

---

## Développement depuis les sources (résumé)

squid repose sur **Electrobun** : processus principal et service local côté Bun, interface dans le WebView système. Si vous développez **à la racine du dépôt cloné** et devez charger les extensions de canaux fournies avec le repo, définissez **`SQUID_ROOT`** vers cette racine (pour que `config/channel-extensions.json` soit trouvé) ; les utilisateurs d’un paquet installé n’en ont en général pas besoin. Modules, extensions et conventions d’outils : **[developer-guide.md](./developer-guide.md)** et **[tool-development-guide.md](./tool-development-guide.md)**.

---

## Autre documentation

| Document | Public visé |
|----------|-------------|
| [QUICK_START.md](./QUICK_START.md) | Mise en route rapide |
| [user-guide.md](./user-guide.md) | Vue d’ensemble des menus et capacités |
| [developer-guide.md](./developer-guide.md) | Développement et extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Écriture ou modification des outils intégrés |
| [RELEASE_NOTES.md](./RELEASE_NOTES.md) | Notes de version |
| [TEST_REPORT.md](./TEST_REPORT.md) | Tests et qualité |

---

## Licence

Ce projet est publié sous **MIT License**.
