# Guide des outils cœur

Ce document décrit l’usage et les limites des dix outils cœur ajoutés dans squid.

## 1. FileEditTool (file_edit)

**Rôle** : remplacement précis de contenu fichier par correspondance de chaîne.

**Paramètres d’entrée** :

- `file_path` (string) : chemin du fichier à modifier
- `old_string` (string) : texte à remplacer
- `new_string` (string) : texte de remplacement
- `replace_all` (boolean, optionnel) : remplacer toutes les occurrences (défaut false)

**Exemple** :

```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**Limites** :

- Plusieurs occurrences sans `replace_all=true` ⇒ erreur
- Correspondance exacte de chaîne, pas d’expressions rationnelles

---

## 2. BashTool (bash)

**Rôle** : exécuter une commande Bash avec délai d’attente et option d’arrière-plan.

**Paramètres** :

- `command` (string) : commande Bash
- `working_directory` (string, optionnel) : répertoire de travail
- `timeout` (number, optionnel) : délai en ms (défaut 30000)
- `run_in_background` (boolean, optionnel) : exécution en arrière-plan

**Exemple** :

```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**Limites** :

- Pas de commandes interactives
- Les tâches d’arrière-plan ne sont pas persistées après redémarrage
- Marqué comme destructif : nécessite la confiance de l’utilisateur

---

## 3. PowerShellTool (powershell)

**Rôle** : exécuter PowerShell (Windows uniquement).

**Paramètres** :

- `command` (string)
- `working_directory` (string, optionnel)
- `timeout` (number, optionnel, défaut 30000)
- `run_in_background` (boolean, optionnel)

**Exemple** :

```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**Limites** :

- Disponible seulement sous Windows ; erreur ailleurs

---

## 4. WebSearchTool (web_search)

**Rôle** : recherche web via DuckDuckGo, liste de résultats.

**Paramètres** :

- `query` (string) : requête
- `max_results` (number, optionnel) : nombre max (défaut 10, plafond 10)

**Exemple** :

```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**Limites** :

- Dépend de la structure HTML de DuckDuckGo (fragile aux changements du site)
- Pas de clé API ; qualité moindre qu’une API payante
- Au plus 10 résultats

---

## 5. Groupe d’outils Cron

### 5.1 CronCreateTool (cron_create)

**Rôle** : créer une tâche planifiée.

**Paramètres** :

- `cron_expression` (string) : expression Cron (ex. `"0 * * * *"` pour chaque heure)
- `task_content` (string) : description du contenu à exécuter

**Exemple** :

```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "Sauvegarde chaque jour à 9h"
}
```

### 5.2 CronDeleteTool (cron_delete)

**Rôle** : supprimer une tâche planifiée.

**Paramètres** :

- `task_id` (string) : identifiant de la tâche

### 5.3 CronListTool (cron_list)

**Rôle** : lister les tâches planifiées.

**Paramètres** : aucun

**Limites** :

- Stockage en mémoire : perte au redémarrage
- Pas de persistance générique (évolution possible ultérieure)

---

## 6. SkillTool (skill)

**Rôle** : invoquer un skill enregistré (modèle de tâche prédéfini).

**Paramètres** :

- `skill_name` (string) : nom du skill
- `args` (string, optionnel) : arguments

**Exemple** :

```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**Limites** :

- Seuls les skills `user-invocable: true`
- Fichiers sous `~/.squid/skills/`
- Dépend de la configuration modèle (`~/.squid/config.json`)
- Peut enchaîner des appels d’outils via la chaîne d’exécution unifiée

---

## 7. BriefTool (brief)

**Rôle** : produire un résumé de contenu (plusieurs styles).

**Paramètres** :

- `content` (string) : texte source
- `prompt` (string, optionnel) : consigne personnalisée
- `type` (enum, optionnel) : `brief`, `detailed`, `bullet_points`

**Exemple** :

```typescript
{
  content: "Long article...",
  type: "bullet_points"
}
```

**Limites** :

- Nécessite la variable d’environnement `ANTHROPIC_API_KEY`
- Troncature au-delà de 50000 caractères
- Appels API externes et coût associé

---

## 8. AgentTool (agent)

**Rôle** : lancer un sous-agent avec contexte distinct.

**Paramètres** :

- `instruction` (string) : consigne
- `timeout` (number, optionnel) : ms (défaut 300000, soit 5 minutes)

**Exemple** :

```typescript
{
  instruction: "Analyser tous les fichiers TypeScript du projet pour repérer des problèmes de performance potentiels",
  timeout: 600000
}
```

**Limites** :

- Dépend de `~/.squid/config.json`
- Délai par défaut 5 minutes, personnalisable
- Exécution via la chaîne unifiée ; métadonnées structurées (exécuteur, mode, répertoire, durée)

---

## Propriétés communes des outils

- **isConcurrencySafe** : peut s’exécuter en parallèle avec d’autres appels
- **isReadOnly** : opération en lecture seule
- **isDestructive** : opération pouvant modifier l’état du système

## Persistance des résultats

Chaque outil implémente `mapToolResultToToolResultBlockParam` :

- Au-delà de `maxResultSizeChars`, enregistrement automatique sur disque
- Retour d’un aperçu pour limiter la taille du contexte

## Sécurité

1. **BashTool / PowerShellTool** : commandes arbitraires — prudence maximale  
2. **FileEditTool** : modification directe — préférer un contrôle de version  
3. **BriefTool / AgentTool** : API externes — protéger les clés  
4. **WebSearchTool** : contenu récupéré potentiellement dangereux — valider avant usage  

## Couverture de tests

Scénarios nominaux, limites, erreurs et conformité d’interface pour chaque outil.

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
