# Documentation développeur squid

Le point d’entrée du bureau est **`src/bun/index.ts`** (Electrobun référence ce fichier via `build.bun.entrypoint` dans `electrobun.config.ts`). Le frontend WebView démarre dans **`src/browser/`**. Lorsque vous modifiez les ressources statiques copiées par défaut, maintenez aussi **`electrobun.config.ts`** (`build.copy`) : le CLI **ne lit pas** de configuration `.js`. **Les paquets publiés doivent inclure `public`, `config` (dont `channel-extensions.json`) et `extensions`**, sinon le scan des extensions échoue et la page Canaux affiche « non enregistré » ou l’absence de configuration Web d’extension.

## Architecture

### Modules principaux

```
src/
├── tasks/           # Gestion des tâches
│   ├── state-machine.ts      # Machine à états (ask/craft/plan)
│   └── context-compressor.ts # Compression de contexte
├── tools/           # Système d’outils
│   ├── base.ts              # Définitions de types
│   ├── read-file.ts         # Lecture fichier
│   ├── write-file.ts        # Écriture fichier
│   ├── glob.ts              # Correspondance de chemins
│   └── grep.ts              # Recherche de contenu
├── models/          # Modèles IA
│   ├── types.ts             # Contrats
│   ├── anthropic.ts         # Adaptateur Anthropic
│   ├── openai.ts            # Adaptateur OpenAI
│   ├── deepseek.ts          # Adaptateur DeepSeek
│   └── registry.ts          # Registre des modèles
├── workspace/     # Espace de travail
│   ├── manager.ts           # Gestion des répertoires
│   └── sandbox.ts           # Bac à sable de chemins
├── permissions/   # Permissions
│   ├── engine.ts            # Moteur de règles
│   └── classifier.ts        # Classification des outils
├── skills/        # Skills
│   ├── loader.ts            # Chargement
│   └── validator.ts         # Validation des permissions
├── experts/       # Experts
│   └── manager.ts           # Gestion
├── channels/      # Canaux (WebUI intégré + chargement d’extensions)
├── claw/          # Contrôle distant
│   ├── server.ts            # Serveur HTTP
│   └── task-handler.ts      # Traitement des tâches
├── utils/         # Files et utilitaires
│   └── messageQueueManager.ts # File par conversation (dont cron)
├── tools/         # Outils (y compris tâches planifiées)
│   ├── cron-manager.ts
│   ├── cron-create.ts
│   ├── cron-list.ts
│   ├── cron-status.ts
│   └── cron-runs.ts
└── ui/            # Interface
    ├── main-layout.tsx
    └── task-wizard.tsx
```

### Principes de conception

1. **Sûreté de typage** : TypeScript + Zod  
2. **Immuabilité** : contraintes `DeepImmutable` sur le contexte  
3. **Modularité** : responsabilités claires  
4. **Extensibilité** : registres pour les extensions  

### Système d’outils

Les outils sont décrits par un type plutôt que par héritage de classe :

```typescript
export type Tool<Input, Output> = {
  name: string;
  description: string;
  inputSchema: z.ZodType<Input>;
  maxResultSizeChars: number;
  call(input: Input, context: ToolContext): Promise<ToolResult<Output>>;
  isConcurrencySafe(input: Input): boolean;
  isReadOnly(input: Input): boolean;
  isDestructive?(input: Input): boolean;
};
```

### Adaptateurs de modèle

Tous les fournisseurs implémentent la même interface :

```typescript
export interface ModelProvider {
  chat(request: ChatRequest): Promise<ChatResponse>;
  streamChat(request: ChatRequest): AsyncIterable<ChatChunk>;
}
```

## Guide d’extension

### Ajouter un outil

1. Créer un fichier dans `src/tools/`
2. Définir le schéma d’entrée (Zod)
3. Implémenter le type `Tool`
4. Enregistrer dans le registre des outils

Exemple :

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './base';

const MyToolInputSchema = z.object({
  param: z.string()
});

export const MyTool: Tool<typeof MyToolInputSchema, string> = {
  name: 'my_tool',
  description: 'Description de l’outil',
  inputSchema: MyToolInputSchema,
  maxResultSizeChars: 10000,
  async call(input, context) {
    // logique
    return { data: 'result' };
  },
  isConcurrencySafe: () => true,
  isReadOnly: () => true
};
```

### Ajouter un fournisseur de modèle

1. Fichier dans `src/models/`
2. Implémenter `ModelProvider`
3. Enregistrer dans `ModelRegistry`

Exemple :

```typescript
import type { ModelProvider, ChatRequest, ChatResponse } from './types';

export class MyModelProvider implements ModelProvider {
  async chat(request: ChatRequest): Promise<ChatResponse> {
    // appel API
    return { content: 'response' };
  }

  async *streamChat(request: ChatRequest) {
    yield { content: 'chunk' };
  }
}
```

### Ajouter un skill

1. Fichier Markdown dans `skills/`
2. Front matter YAML
3. Prompt système

Exemple :

```markdown
---
name: my-skill
description: Description du skill
allowed-tools:
  - read_file
  - write_file
---

Vous êtes un assistant spécialisé dans…
```

### Ajouter un expert

Dans `src/experts/types.ts` :

```typescript
export const myExpert: ExpertRole = {
  id: 'my-expert',
  name: 'Nom de l’expert',
  description: 'Description',
  systemPrompt: 'Vous êtes…'
};
```

## Tests

```bash
npm test
npm run test:watch
```

Pour les tests manuels canaux / intégration, voir [integration-testing.md](./integration-testing.md). D’éventuels scripts `test:integration`, `test:coverage`, etc. figurent dans `package.json` à la racine.

## Build et publication

```bash
# Développement bureau (Electrobun)
npm run dev

# Compilation TypeScript
npm run build

# Empaquetage bureau (canal dev, sortie dans build/)
npm run build:electron

# Build release stable (sortie artifacts/, pour CI / Release)
npm run build:electron:release
```

## Guide de contribution

### Langue et contraintes i18n

1. Commentaires de code en anglais pour tout ajout ou modification.  
2. Prompts système / `promptTemplate` en anglais.  
3. Texte visible : préférer les entrées i18n plutôt que des chaînes en dur dans la logique métier.  
4. Nouvelle documentation : arborescence `docs/locales/<locale>/` ; pages non traduites retombent sur l’anglais.

### Flux Git

1. Fork du dépôt  
2. Branche de fonctionnalité  
3. Commits  
4. Push  
5. Pull Request  

## Licence

MIT License
