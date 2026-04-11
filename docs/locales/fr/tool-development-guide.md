# Guide de développement des outils

Ce document définit les conventions d’implémentation des outils dans squid : format de sortie unifié, seuils de taille et persistance automatique pour préserver le contexte et l’expérience utilisateur.

## Principes directeurs

1. **Efficacité du contexte** — les gros résultats sont persistés automatiquement pour ne pas saturer le contexte.  
2. **Format de sortie unifié** — chaque outil expose un mapping vers le format API standard.  
3. **Compatibilité ascendante** — la nouvelle convention ne casse pas les outils existants.  
4. **Testabilité** — le comportement de chaque outil doit être vérifiable.  

## Contrat d’interface d’un outil

Chaque outil doit implémenter :

```typescript
interface Tool<Input extends z.ZodType = z.ZodType, Output = unknown, P = any> {
  name: string;
  description: string;
  inputSchema: Input;
  maxResultSizeChars: number;
  call(
    input: z.infer<Input>,
    context: ToolContext,
    onProgress?: ToolCallProgress<P>
  ): Promise<ToolResult<Output>>;
  mapToolResultToToolResultBlockParam(
    content: Output,
    toolUseID: string
  ): ToolResultBlockParam;
  isConcurrencySafe(input: z.infer<Input>): boolean;
  isReadOnly(input: z.infer<Input>): boolean;
  isDestructive?(input: z.infer<Input>): boolean;
}
```

## Propriétés clés

### maxResultSizeChars

Seuil au-delà duquel le résultat est persisté sur disque et un aperçu est renvoyé.

**Valeurs recommandées :**

- Outils génériques : `50000` (environ 50 Ko)  
- Outils à grande sortie (ex. lecture fichier) : `50000`  
- Outils qui bornent eux-mêmes la sortie : `Infinity` (désactive la persistance automatique côté hôte pour ce critère)

**Exemples :**

```typescript
export const ReadFileTool: Tool = {
  name: 'read_file',
  maxResultSizeChars: Infinity,
  // ...
};

export const GrepTool: Tool = {
  name: 'grep',
  maxResultSizeChars: 50000,
  // ...
};
```

### isConcurrencySafe et l’ordonnancement dans un tour

Le TaskExecutor partitionne les `tool_call` d’un même message assistant : les appels **adjacents** dont `isConcurrencySafe` est vrai pour les **paramètres courants** sont regroupés et exécutés via `Promise.all` ; sinon exécution séquentielle par segments. Même si `write_file` / `file_edit` déclarent la concurrence, évaluez les **effets de bord intra-lot** (conflits de chemins) ; l’hôte applique des contrôles sur les chemins d’écriture dans un lot — renseignez `isConcurrencySafe` de façon honnête selon que l’`input` courant peut s’exécuter en parallèle avec d’autres appels.

## Implémenter mapToolResultToToolResultBlockParam

Cette méthode transforme la sortie de l’outil en `ToolResultBlockParam` attendu par l’API.

### Modèle de base

```typescript
mapToolResultToToolResultBlockParam(
  content: Output,
  toolUseID: string
): ToolResultBlockParam {
  if (!content) {
    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: `(${this.name} completed with no output)`,
    };
  }
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: this.formatOutput(content),
  };
}
```

### Sortie texte

```typescript
mapToolResultToToolResultBlockParam(content: string, toolUseID: string) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: content || `(${this.name} completed with no output)`,
  };
}
```

### Sortie structurée

```typescript
mapToolResultToToolResultBlockParam(
  content: { matches: string[]; count: number },
  toolUseID: string
) {
  const formatted = `Found ${content.count} matches:\n${content.matches.join('\n')}`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: formatted,
  };
}
```

### Erreurs

```typescript
mapToolResultToToolResultBlockParam(
  content: { error: string } | string,
  toolUseID: string
) {
  const isError = typeof content === 'object' && 'error' in content;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: isError ? content.error : content,
    is_error: isError,
  };
}
```

### Formatage enrichi (ReadFile)

```typescript
mapToolResultToToolResultBlockParam(
  content: { path: string; content: string; lines: number },
  toolUseID: string
) {
  const header = `File: ${content.path} (${content.lines} lines)\n\n`;
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: header + content.content,
  };
}
```

## Intégration à la persistance

Le développeur d’outil **ne** gère **pas** manuellement la persistance. Le système :

1. Appelle `mapToolResultToToolResultBlockParam`  
2. Compare la taille du résultat à `maxResultSizeChars`  
3. Si dépassement, écrit sous `~/.squid/sessions/<sessionId>/tool-results/<toolUseId>.txt`  
4. Remplace le contenu par un message d’aperçu  

**Exemple de message d’aperçu :**

```
<persisted-output>
Output too large (125.5 KB). Full output saved to: /path/to/file.txt

Preview (first 2.0 KB):
[first 2000 bytes]
...
</persisted-output>
```

## Exemple complet (Grep)

```typescript
import { z } from 'zod';
import type { Tool, ToolContext, ToolResult } from './types';
import type { ToolResultBlockParam } from '@anthropic-ai/sdk/resources/index.mjs';

const GrepInputSchema = z.object({
  pattern: z.string(),
  path: z.string().optional(),
});

type GrepInput = z.infer<typeof GrepInputSchema>;
type GrepOutput = {
  matches: Array<{ file: string; line: number; content: string }>;
  count: number;
};

export const GrepTool: Tool<typeof GrepInputSchema, GrepOutput> = {
  name: 'grep',
  description: 'Search for patterns in files',
  inputSchema: GrepInputSchema,
  maxResultSizeChars: 50000,

  async call(
    input: GrepInput,
    context: ToolContext
  ): Promise<ToolResult<GrepOutput>> {
    const matches = await searchFiles(input.pattern, input.path);
    return {
      data: {
        matches,
        count: matches.length,
      },
    };
  },

  mapToolResultToToolResultBlockParam(
    content: GrepOutput,
    toolUseID: string
  ): ToolResultBlockParam {
    if (!content || content.count === 0) {
      return {
        type: 'tool_result',
        tool_use_id: toolUseID,
        content: 'No matches found',
      };
    }

    const formatted = [
      `Found ${content.count} matches:`,
      '',
      ...content.matches.map(m => 
        `${m.file}:${m.line}: ${m.content}`
      ),
    ].join('\n');

    return {
      type: 'tool_result',
      tool_use_id: toolUseID,
      content: formatted,
    };
  },

  isConcurrencySafe: () => true,
  isReadOnly: () => true,
  isDestructive: () => false,
};
```

## Guide de tests

### Tests unitaires du mapping

```typescript
describe('GrepTool.mapToolResultToToolResultBlockParam', () => {
  it('should format matches correctly', () => {
    const output: GrepOutput = {
      matches: [
        { file: 'test.ts', line: 10, content: 'const foo = "bar"' },
      ],
      count: 1,
    };
    const result = GrepTool.mapToolResultToToolResultBlockParam(output, 'test-id');
    expect(result.content).toContain('Found 1 matches');
    expect(result.content).toContain('test.ts:10');
  });

  it('should handle empty results', () => {
    const output: GrepOutput = { matches: [], count: 0 };
    const result = GrepTool.mapToolResultToToolResultBlockParam(output, 'test-id');
    expect(result.content).toBe('No matches found');
  });
});
```

### Tests d’intégration — persistance

```typescript
describe('Tool result persistence', () => {
  it('should persist large results', async () => {
    const result = await GrepTool.call({ pattern: 'test', path: '.' }, context);
    const mapped = GrepTool.mapToolResultToToolResultBlockParam(result.data, 'test-id');
    const processed = await processToolResultBlock(GrepTool, result.data, 'test-id');
    expect(processed.content).toContain('<persisted-output>');
    expect(processed.content).toContain('Full output saved to:');
  });
});
```

## Migration d’un outil existant

### Étape 1 : ajouter maxResultSizeChars

```typescript
export const MyTool: Tool = {
  // ...
  maxResultSizeChars: 50000,
};
```

### Étape 2 : implémenter le mapping

```typescript
mapToolResultToToolResultBlockParam(content, toolUseID) {
  return {
    type: 'tool_result',
    tool_use_id: toolUseID,
    content: typeof content === 'string' ? content : JSON.stringify(content),
  };
},
```

### Étape 3 : valider

Petits résultats intacts, gros résultats persistés avec aperçu, formatage conforme aux attentes.

## FAQ

**Quand mettre `maxResultSizeChars` à `Infinity` ?**  
Lorsque l’outil borne déjà sa sortie (ex. `limit` sur ReadFile).

**Le mapping doit-il gérer les erreurs ?**  
Oui : si `call` renvoie une erreur, utiliser `is_error: true` lorsque c’est pertinent.

**Formatage lourd dans le mapping ?**  
Autorisé, mais le mapping s’exécute à chaque appel : rester efficace.

**Données binaires ou images ?**  
La persistance automatique est textuelle ; pour les images, renvoyer les blocs image attendus par l’API — la persistance textuelle peut être ignorée.

**Nettoyage des fichiers persistés ?**  
Stockage sous `~/.squid/sessions/<sessionId>/tool-results/`. Nettoyage manuel des anciennes sessions, script planifié, ou surveillance de l’espace disque.

**Exemple de nettoyage :**

```bash
find ~/.squid/sessions -type d -mtime +7 -exec rm -rf {} \;
```

## Gestion des fichiers persistés

### Emplacement

- Chemin : `~/.squid/sessions/<sessionId>/tool-results/`  
- Fichiers : `<toolUseId>.txt` ou `.json`  
- Isolation par session  

### Stratégies de nettoyage recommandées

1. **Temporel** — supprimer les sessions plus vieilles que N jours.  
2. **Par taille totale** — lorsque le volume dépasse un plafond, supprimer les plus anciennes.  
3. **Fin de session** — option utilisateur pour purger immédiatement.  

### Surveillance

- Taille du dossier `~/.squid/sessions/`  
- Alertes espace disque  
- Compteur d’échecs de persistance  

## Références

- **Référence claude-code-main** : `claude-code-main/src/utils/toolResultStorage.ts` (dépôt miroir / amont du monorepo)  
- **Définition du type Tool** : `src/tools/base.ts`  
- **Exemples** : `src/tools/read-file.ts`, `src/tools/grep.ts`  

## Journal des mises à jour du document

- **2026-04-04** : version initiale, conventions d’implémentation des outils  
