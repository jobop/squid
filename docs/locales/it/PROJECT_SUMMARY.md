# Panoramica progetto squid

Questo documento riassume confini funzionali e suddivisione modulare per revisione prodotto/tecnica; in caso di divergenza fa fede il codice sorgente.

## Posizionamento

squid: postazione di lavoro AI **local-first** (Electrobun + Bun + WebView di sistema). I dati predefiniti risiedono in `~/.squid` nella home utente.

## Capacità implementate (sintesi)

### Attività e contesto

- Modello dati attività e macchina a stati Ask / Craft / Plan  
- Compressione contesto e persistenza attività  
- Permessi e classificazione del rischio strumenti  

### Modelli

- Adattatori e registry per Anthropic, OpenAI, DeepSeek, ecc. (vedi `src/models`)  
- Output in streaming, conteggio token, archiviazione cifrata delle chiavi  

### Area di lavoro e strumenti

- Binding directory di lavoro e sandbox sui percorsi  
- ReadFile, WriteFile, Glob, Grep e mappatura unificata dei risultati strumento con limite di dimensione  

### Skill ed esperti

- Skill in YAML, loader, whitelist e hook  
- Skill ed esperti incorporati; alcune parti dell’UI sono ancora in evoluzione  

### Claw e scheduling

- Servizio HTTP Claw ed elaborazione attività (`src/claw`); se il desktop abiliti Claw di default dipende da `src/bun/index.ts`  
- Attività pianificate con node-cron, cronologia esecuzione, notifiche e-mail (se configurato)  

### Canali

- Registry canali e WebUI integrato  
- Canali estesi: `extensions/` + directory utente, manifest dichiarativo e bridge TaskAPI  
- EventBridge, WebSocket e integrazione UI (vedi `../../webui-channel.md`, ecc.)  

### Desktop e frontend

- Interfaccia React principale, impostazioni, pagine attività e sessione  
- API HTTP locale (`Bun.serve` nel processo principale, chiamate dall’UI)  

### Qualità

- Test unitari e di integrazione con Vitest (vedi [TEST_REPORT.md](../../TEST_REPORT.md))  
- Documentazione utente e sviluppatore in `docs/`  

## Test e gate di qualità

Ultimo archivio citato: 9 file di test, 31 casi superati (vedi TEST_REPORT). Prima del merge si consiglia `npm test` in locale.

## Sicurezza (sintesi)

- Sandbox percorsi e marcatura strumenti read-only / distruttivi  
- Protezione locale delle chiavi (es. AES-256-GCM tramite `secure-storage`)  
- Token Claw e motore permessi (ove i percorsi siano abilitati)  

## Prestazioni (sintesi)

- LRU, virtual scrolling, lazy loading, risposte in streaming, compressione contesto (secondo i moduli coinvolti)  

## Documentazione

| Documento | Uso |
|-----------|-----|
| [QUICK_START.md](../../QUICK_START.md) | Avvio rapido utente |
| [user-guide.md](../../user-guide.md) | Descrizione funzionalità |
| [developer-guide.md](../../developer-guide.md) | Architettura ed estensioni |
| [tool-development-guide.md](../../tool-development-guide.md) | Convenzioni sviluppo strumenti |
| [TEST_REPORT.md](../../TEST_REPORT.md) | Report test |

## Versione

Il numero di versione del repository è definito in `package.json`; le note di rilascio sono in [RELEASE_NOTES.md](../../RELEASE_NOTES.md).
