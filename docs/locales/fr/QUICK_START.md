# Guide de démarrage rapide squid

Destiné aux utilisateurs finaux : installer et lancer squid en local, configurer le modèle, puis converser et lancer des tâches. Architecture et extensions : [developer-guide.md](./developer-guide.md).

## Positionnement produit

squid est un **poste de travail IA de bureau exécuté en local**, adapté à :

- Lecture de code, revue et modifications légères dans un répertoire de travail défini (selon le mode de tâche et le bac à sable)
- Tâches documentaires, recherche et structuration avec skills et experts
- Tâches planifiées locales déclenchées par Cron
- **Extensions de canaux** Feishu, Telegram, WeChat, etc. (configuration séparée, voir [channel-extensions.md](./channel-extensions.md))

## Environnement et démarrage

**Depuis les sources (recommandé pour les développeurs)**

- Node.js 22 LTS et npm recommandés ; le shell bureau repose sur Electrobun (le CLI est préparé par plateforme lors de `npm run dev`).
- La racine du projet doit contenir **`electrobun.config.ts`** (Electrobun ne lit que ce nom de fichier).

```bash
cd squid
npm install
npm run dev
```

**Paquets publiés**

Si vous utilisez un installateur ou une archive depuis GitHub Release, suivez les instructions de la plateforme. Sur macOS, les builds non signés / non notarisés peuvent nécessiter un clic droit « Ouvrir » ou une exception dans les réglages système ; voir le [README.md](./README.md) à la racine du dépôt.

## Configurer les clés API

Configurez au moins un fournisseur de modèle (dans **Réglages** de l’application, puis enregistrement ; les secrets sont écrits dans `~/.squid/config.json` sur la machine locale) :

| Fournisseur | Indication |
|-------------|------------|
| Anthropic | Créer une clé API sur [Anthropic Console](https://console.anthropic.com/) |
| OpenAI | Créer une clé sur [OpenAI Platform](https://platform.openai.com/) |
| Point de terminaison compatible | Renseigner l’URL de base et le nom du modèle dans les réglages (protocole compatible avec celui attendu par l’application) |

## Premier parcours

1. Au lancement, ouvrez **Réglages** dans la barre latérale et enregistrez le modèle et les options utiles.
2. Dans le chat ou l’écran de tâche, **choisissez le répertoire de travail** (ne définissez pas une racine non fiable comme workspace).
3. **Créez une session ou une tâche** et choisissez un mode :
   - **Ask** : plutôt lecture seule et analyse ; en principe pas de modification proactive des fichiers (selon la version).
   - **Craft** : la chaîne d’outils peut s’exécuter automatiquement et modifier des fichiers dans le workspace.
   - **Plan** : planification et découpage, adapté aux demandes complexes.
4. Sélectionnez au besoin un **skill** ou un **expert**.

## Canaux et Feishu (optionnel)

- La barre latérale **Canaux** affiche l’état du WebUI intégré et des extensions.
- L’implémentation Feishu se trouve sous `extensions/feishu/` ; l’activation par défaut dans `config/channel-extensions.json` dépend du dépôt. La liste activée côté utilisateur peut être dans `~/.squid/channel-extensions.json`.
- Les extensions personnelles ou tierces peuvent aller dans `~/.squid/extensions/<dossier>/`, voir [channel-extensions.md](./channel-extensions.md).

La création du bot Feishu, le long polling / webhook et les champs de `~/.squid/feishu-channel.json` suivent les textes de l’application et [user-guide.md](./user-guide.md).

## Exemples de tâches courantes

**Revue de code (Ask)**

```text
Mode : Ask
Répertoire de travail : <chemin de votre projet>
Consigne : résumer les responsabilités des modules principaux sous src et proposer des pistes lisibilité / défauts évidents.
```

**Documentation par lots (Craft)**

```text
Mode : Craft
Répertoire de travail : <chemin du projet>
Consigne : générer des brouillons Markdown pour les API publiques du dossier indiqué.
```

**Tâches planifiées**

Sur la page **Tâches planifiées**, créez une entrée avec une expression Cron et le contenu à transmettre au modèle ; si l’application n’est pas lancée, le planificateur ne s’exécute pas.

## Skills et experts

- **Skills** : choisissez un skill installé dans l’interface ; les fichiers sont sous `~/.squid/skills/` (y compris les installations SkillHub).
- **Experts** : rôles système et limites ; gérés dans les pages dédiées **Experts**.

## FAQ

**Les clés restent-elles uniquement en local ?**  
Oui. Ne commitez pas la configuration ; sauvegardez `~/.squid` si besoin.

**Les tâches modifient-elles des fichiers ?**  
Cela dépend du mode et de la politique d’outils : Ask plutôt lecture seule ; Craft peut écrire ; Plan explique souvent avant d’agir. Suivez les indications de l’interface.

**Limites du répertoire de travail ?**  
Les outils fichiers sont en principe limités au répertoire lié à la session ; les détails suivent le bac à sable et les permissions.

**Comment arrêter une tâche en cours ?**  
Utilisez le contrôle d’arrêt / interruption dans l’UI (libellé selon la version).

**Les tâches planifiées tournent-elles à l’application fermée ?**  
Non ; le planificateur nécessite un processus actif.

## Pour aller plus loin

| Document | Contenu |
|----------|---------|
| [user-guide.md](./user-guide.md) | Fonctionnalités et interface |
| [developer-guide.md](./developer-guide.md) | Arborescence et extensions |
| [tool-development-guide.md](./tool-development-guide.md) | Conventions des outils intégrés |
| [TEST_REPORT.md](./TEST_REPORT.md) | Aperçu des tests automatisés |

Retours et contributions : Issues / Pull Requests du dépôt.
