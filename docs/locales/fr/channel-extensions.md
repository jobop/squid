# Extensions de canal (chargement dynamique)

## Modèle de confiance P0 (à lire en premier)

Les extensions sont chargées par Bun via **`import()` dynamique** dans le **même processus** que le processus principal : ce n’est **pas** un isolement mémoire de type bac à sable. **Installez et configurez uniquement des extensions de confiance** (origine vérifiable et auditable). Sans `roots` configurés, aucune extension n’est chargée ; **Feishu** est fourni avec le dépôt sous `extensions/feishu/`, en principe activé par `enabled: ["feishu"]` dans `config/channel-extensions.json` (la page Canaux indique la source « Extension »).

Priorité et conflits :

- **Intégré** : seul WebUI ; **Feishu** et les autres extensions passent par le chargeur. Les extensions **ne doivent pas remplacer** un `id` déjà enregistré (WebUI intégré `webui` en premier) ; en cas de conflit, l’extension est ignorée et une entrée est ajoutée à `errors` de `GET /api/channels`.
- Si deux paquets d’extension déclarent le même `id`, **le premier enregistré avec succès l’emporte**, le second est ignoré.

## Structure du paquet

Un sous-dossier par plugin ; le répertoire parent est indiqué par `roots` dans la configuration :

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # ou .js selon main
```

### channel-plugin.json

| Champ | Description |
|-------|-------------|
| `id` | Identifiant unique, doit coïncider avec `ChannelPlugin.id` renvoyé par l’usine d’entrée |
| `name` | Nom affiché |
| `version` | Chaîne de version |
| `main` | Point d’entrée ESM relatif au dossier du plugin, pas de chemin absolu ni de `..` |
| `capabilities` / `permissions` | Optionnel, réservé |

### Module d’entrée

**Export par défaut** ou export nommé **`createChannelPlugin`** : une fabrique renvoyant `ChannelPlugin` ou `Promise<ChannelPlugin>`.

L’interface est définie dans `src/channels/types.ts` (`config`, `outbound`, `status` obligatoires ; `setup` recommandé pour connexions longues durée, etc.).

## Configuration

Fusion de deux emplacements (les deux existent : fusion des `roots` ; **`enabled` est prioritaire dans `~/.squid/channel-extensions.json`**) :

1. `squid/config/channel-extensions.json` (créable à partir de `config/channel-extensions.example.json`)
2. `~/.squid/channel-extensions.json`

Champs :

- **`roots`** : `string[]`, chaque élément est un **répertoire parent** contenant **plusieurs sous-dossiers de plugins**. Peut être un chemin absolu ou relatif à la **racine du dépôt squid**.
- **`enabled`** (optionnel) : si absent ou `null`, tous les paquets candidats valides sont tentés ; si `[]`, aucune extension ; si tableau non vide, **seuls** les `id` listés sont chargés.

### Répertoire utilisateur `~/.squid/extensions` (sans l’ajouter à `roots`)

Si le dossier **`~/.squid/extensions`** existe, il est **fusionné automatiquement** comme racine de scan supplémentaire avec les `roots` ci-dessus (s’il n’existe pas, il est ignoré sans erreur). Vous pouvez y placer par ex. `~/.squid/extensions/my-plugin/channel-plugin.json`. Le chargement reste soumis à la liste blanche **`enabled`** (par défaut seulement `feishu` : ajoutez l’`id` de votre plugin dans `~/.squid/channel-extensions.json` ou la config projet).

Après modification de la configuration, **redémarrer** le processus hôte.

## Exemple

Le dépôt contient `extensions/example-echo-channel/`. Dans `config/channel-extensions.json` :

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

Après redémarrage, la barre latérale **Canaux** doit afficher `echo-demo` avec la source « Extension ».

## API

- `GET /api/channels` renvoie `{ "channels": [...], "errors": [...] }`. Chaque canal inclut `source` : `"builtin"` | `"extension"`. `errors` liste les erreurs non fatales du scan / chargement (sans secrets).

## Débogage local

1. Créez un sous-dossier sous `roots` avec `channel-plugin.json`.  
2. Si l’entrée est en TypeScript, assurez-vous qu’elle est chargée par **Bun** (backend bureau actuel).  
3. Consultez les journaux `[ChannelExtensions]` et la bannière orange en tête d’UI.

## Session occupée, file d’attente et renvoi de réponse (sans étendre davantage `QueuedCommand`)

Comme pour Feishu / Telegram, pour qu’un nouveau canal **renvoie le texte de l’assistant dans le même fil après exécution de la file** :

1. Dans **`setup.initialize`** de l’extension, si le contexte d’usine expose **`ctx.taskAPI`** (injecté quand l’hôte appelle `initializeBuiltinChannels(taskAPI)`), appelez votre **`registerXxxSquidBridge(ctx.taskAPI)`** (ou équivalent) ; dans le pont, **`taskAPI.addChannelQueuedCompleteHandler(...)`** et n’envoyez un message que si `cmd.channelReply?.channelId === '<votre id de canal>'` ; dans **`setup.cleanup`**, appelez la fonction de désinstallation retournée par le pont. **L’hôte n’a pas** à importer `registerXxxSquidBridge` canal par canal.
2. Lorsque la session est occupée, **`enqueueFromRequest(..., { channelReply: { channelId: '<idem>', chatId: '<clé de routage>' } })`**. `chatId` est une chaîne transmise telle quelle ; la sémantique relève du canal.

Voir le type **`ChannelQueueReply`** dans `src/utils/messageQueueManager.ts`. N’ajoutez pas de champs `xxxChatId` spécifiques au cœur.

## Rapport avec les contributions intégrées

- **Intégré** : les implémentations peuvent toujours être ajoutées dans `src/channels` et enregistrées dans `initializeBuiltinChannels` via PR.  
- **Extension** : adapté aux plugins privés ou expérimentaux sans modifier le registre central ; la responsabilité sécurité incombe à la configuration et à l’origine de l’extension.
