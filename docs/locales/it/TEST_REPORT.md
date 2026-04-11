# Report test squid

## Informazioni esecuzione

- **Data registrazione**: 2026-04-03  
- **File di test**: 9/9 superati  
- **Casi di test**: 31/31 superati  
- **Durata**: circa 658 ms (singola esecuzione locale; variabile in base alla macchina)

## Copertura per file

| File di test | Focus |
|--------------|--------|
| core.test.ts | Macchina a stati attività, sandbox area di lavoro |
| state-machine.test.ts | Transizioni Ask / Craft / Plan e transizioni illegali |
| sandbox.test.ts | Percorsi dentro/fuori area, traversal e percorsi assoluti |
| skill-loader.test.ts | Caricamento skill da Markdown, formati errati |
| cron-tools.test.ts | Creazione/eliminazione attività pianificate, stato e log esecuzione |
| e2e.test.ts | Flussi file: lettura/scrittura, Glob, Grep |
| claw-integration.test.ts | POST /task, GET /task/:id, 404 |
| integration.test.ts | Struttura strumenti |
| system-integration.test.ts | Inizializzazione moduli, creazione Claw, macchina a stati, caricamento esperti |

## Checklist funzionale (sintesi)

- Gestione attività: macchina a stati, transizioni e percorsi errore  
- Area di lavoro: binding directory e sandbox  
- Strumenti: ReadFile, WriteFile, Glob, Grep  
- Skill: parsing YAML e caricamento  
- Esperti: elenco incorporato e query  
- Claw: HTTP API e risposte errore (come da casi di test)  
- Attività pianificate: creazione, eliminazione, stato e log esecuzione  
- Integrazione sistema: end-to-end e cooperazione tra moduli  

## Prestazioni (riferimento)

- Ordine di grandezza medio per test: millisecondi (vedi output `npm test`)  
- I casi più lenti sono spesso nel flusso E2E sui file  

## Conteggio casi per modulo (riferimento)

| Modulo | Casi (circa) |
|--------|----------------|
| Gestione attività | 5 |
| Macchina a stati | 5 |
| Sandbox | 5 |
| Skill | 2 |
| Strumenti Cron | 16 |
| Strumenti | 3 |
| Claw API | 3 |
| Integrazione sistema | 4 |
| End-to-end | 1 |

## Conclusione

Per il lotto registrato tutti i casi automatizzati sopra elencati sono passati; servono per la regressione della logica core, della sandbox e di parte del comportamento API. Prima del deploy eseguire comunque `npm test` sull’ambiente di destinazione e integrare verifiche manuali su UI, canali e servizi di terze parti.

**Nota**: la verifica completa della shell desktop (Electrobun) e delle estensioni canale richiede test manuali o E2E dedicati; questo report non sostituisce la [guida integrazione](../../integration-testing.md).
