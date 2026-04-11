# Guida agli strumenti core

Questo documento descrive l’uso e i limiti di dieci strumenti core aggiunti in squid.

## 1. FileEditTool (file_edit)

**Funzione**: modifica precisa del contenuto file tramite corrispondenza stringa e sostituzione.

**Parametri di input**:
- `file_path` (string): percorso del file da modificare
- `old_string` (string): testo da sostituire
- `new_string` (string): nuovo testo
- `replace_all` (boolean, opzionale): sostituire tutte le occorrenze (predefinito false)

**Esempio**:
```typescript
{
  file_path: "src/index.ts",
  old_string: "const port = 3000",
  new_string: "const port = 8080"
}
```

**Limitazioni**:
- Se ci sono più occorrenze e `replace_all` non è true, viene restituito un errore
- Solo corrispondenza stringa esatta, nessuna espressione regolare

---

## 2. BashTool (bash)

**Funzione**: esegue comandi Bash con timeout e opzione esecuzione in background.

**Parametri di input**:
- `command` (string): comando Bash
- `working_directory` (string, opzionale): directory di lavoro
- `timeout` (number, opzionale): timeout in millisecondi (predefinito 30000)
- `run_in_background` (boolean, opzionale): eseguire in background

**Esempio**:
```typescript
{
  command: "npm install",
  working_directory: "/path/to/project",
  timeout: 60000
}
```

**Limitazioni**:
- Nessun comando interattivo
- I job in background non sono persistenti: si perdono al riavvio
- Operazione considerata distruttiva: richiede fiducia dell’utente

---

## 3. PowerShellTool (powershell)

**Funzione**: esegue comandi PowerShell (solo Windows).

**Parametri di input**:
- `command` (string): comando PowerShell
- `working_directory` (string, opzionale): directory di lavoro
- `timeout` (number, opzionale): timeout in ms (predefinito 30000)
- `run_in_background` (boolean, opzionale): esecuzione in background

**Esempio**:
```typescript
{
  command: "Get-Process | Where-Object {$_.CPU -gt 100}",
  timeout: 10000
}
```

**Limitazioni**:
- Disponibile solo su Windows
- Su altre piattaforme restituisce errore

---

## 4. WebSearchTool (web_search)

**Funzione**: ricerca web tramite DuckDuckGo, elenco risultati.

**Parametri di input**:
- `query` (string): testo di ricerca
- `max_results` (number, opzionale): numero massimo risultati (predefinito 10, massimo 10)

**Esempio**:
```typescript
{
  query: "TypeScript best practices",
  max_results: 5
}
```

**Limitazioni**:
- Dipende dalla struttura HTML di DuckDuckGo: può rompersi con cambiamenti del sito
- Nessuna API key, qualità variabile rispetto a API a pagamento
- Massimo 10 risultati

---

## 5. Gruppo strumenti Cron

### 5.1 CronCreateTool (cron_create)

**Funzione**: crea un’attività pianificata.

**Parametri**:
- `cron_expression` (string): espressione Cron (es. `"0 * * * *"` ogni ora)
- `task_content` (string): descrizione del contenuto da eseguire

**Esempio**:
```typescript
{
  cron_expression: "0 9 * * *",
  task_content: "Esegui backup ogni giorno alle 9:00"
}
```

### 5.2 CronDeleteTool (cron_delete)

**Funzione**: elimina un’attività pianificata.

**Parametri**:
- `task_id` (string): ID attività da eliminare

### 5.3 CronListTool (cron_list)

**Funzione**: elenca tutte le attività pianificate.

**Parametri**: nessuno

**Limitazioni**:
- Memorizzazione in memoria: si perde al riavvio
- Nessuna persistenza (possibile in versioni future)

---

## 6. SkillTool (skill)

**Funzione**: invoca una skill registrata (modello di attività predefinito).

**Parametri**:
- `skill_name` (string): nome skill
- `args` (string, opzionale): argomenti per la skill

**Esempio**:
```typescript
{
  skill_name: "code-review",
  args: "src/components/Button.tsx"
}
```

**Limitazioni**:
- Solo skill con `user-invocable: true`
- I file skill devono trovarsi in `~/.squid/skills/`
- L’esecuzione dipende dalla configurazione modello (`~/.squid/config.json`)
- L’esecuzione segue la pipeline unificata e può attivare altri strumenti

---

## 7. BriefTool (brief)

**Funzione**: genera un riassunto del contenuto, più tipi di sintesi.

**Parametri**:
- `content` (string): testo da riassumere
- `prompt` (string, opzionale): prompt personalizzato
- `type` (enum, opzionale): `brief` (breve), `detailed` (dettagliato), `bullet_points` (elenco puntato)

**Esempio**:
```typescript
{
  content: "Testo lungo dell’articolo...",
  type: "bullet_points"
}
```

**Limitazioni**:
- Richiede variabile d’ambiente `ANTHROPIC_API_KEY`
- Contenuti oltre 50000 caratteri vengono troncati
- Dipende da API esterne con possibili costi

---

## 8. AgentTool (agent)

**Funzione**: crea un sub-agente per compiti complessi con contesto separato.

**Parametri**:
- `instruction` (string): istruzione per il compito
- `timeout` (number, opzionale): timeout in ms (predefinito 300000, 5 minuti)

**Esempio**:
```typescript
{
  instruction: "Analizza tutti i file TypeScript del progetto e individua potenziali problemi di prestazioni",
  timeout: 600000
}
```

**Limitazioni**:
- Dipende dalla configurazione modello (`~/.squid/config.json`)
- Timeout predefinito 5 minuti, personalizzabile
- Esecuzione sulla pipeline unificata; metadati strutturati (esecutore, modalità, directory di lavoro, durata)

---

## Proprietà degli strumenti

Ogni strumento espone:

- **isConcurrencySafe**: se può essere eseguito in concorrenza
- **isReadOnly**: se l’operazione è in sola lettura
- **isDestructive**: se può alterare in modo significativo lo stato del sistema

## Persistenza risultati

Tutti gli strumenti implementano `mapToolResultToToolResultBlockParam` e supportano la persistenza dei risultati:

- Se l’output supera `maxResultSizeChars`, viene salvato su disco
- Viene restituita un’anteprima per non saturare il contesto

## Note di sicurezza

1. **BashTool e PowerShellTool**: possono eseguire comandi arbitrari: usare con cautela.
2. **FileEditTool**: modifica direttamente i file; preferire controllo di versione.
3. **BriefTool e AgentTool**: chiamano API esterne: proteggere le chiavi.
4. **WebSearchTool**: i contenuti scaricati possono essere malevoli: validare prima dell’uso.

## Copertura test

Ogni strumento ha test unitari per scenari nominali, edge case, errori e conformità interfaccia.

Esecuzione mirata:

```bash
npm test -- file-edit.test.ts bash.test.ts powershell.test.ts web-search.test.ts cron-tools.test.ts skill.test.ts brief.test.ts agent.test.ts
```
