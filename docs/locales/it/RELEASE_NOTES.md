# Note di rilascio squid v0.1.0

## Aggiornamenti recenti (2026-04-10)

### Completamento pipeline immagini dai canali

- Immagini in ingresso da Telegram, Feishu e WeChat personale: percorso unificato «scarica nel workspace + `mentions(file)`».
- In caso di accodamento per canale occupato si mantiene lo stesso `mentions`, evitando la perdita dell’immagine nel percorso a coda.
- Nuova capacità condivisa lato estensione: `extensions/shared/workspace-image-store.ts`.

### Comando canale di interruzione `/wtf`

- Aggiunto `/wtf` in `TaskAPI.executeTaskStream`, stessa semantica del tasto ESC nel Web: interrompe solo l’attività in esecuzione per la sessione corrente, senza svuotare la coda.
- Il ramo `/wtf` viene valutato **prima** del controllo «sessione occupata», così l’interruzione è immediata anche quando la sessione è busy.
- Test di bridge Telegram / Feishu / WeChat aggiornati per verificare che `/wtf` passi al ramo comandi unificato.

## Panoramica

Prima versione pubblica di squid: postazione di lavoro AI desktop basata su Electrobun, con chat multi-modello, modalità attività, skill ed esperti, pianificazione Cron e canali estendibili (Feishu, Telegram, WeChat, ecc., da abilitare secondo necessità).

## Funzionalità principali

### Attività e area di lavoro

- Modalità: Ask (prevalenza sola lettura), Craft (esecuzione strumenti automatica), Plan (pianificazione e conferma)
- Macchina a stati e persistenza attività
- Binding directory di lavoro e sandbox sui percorsi

### Modelli

- Serie Claude Anthropic (modelli selezionabili nelle impostazioni)
- Interfaccia compatibile OpenAI
- Endpoint compatibili DeepSeek (in base adattatori e impostazioni correnti)
- Output in streaming e statistiche token (come da implementazione)
- Archiviazione locale cifrata delle chiavi API

### Skill ed esperti

- Modelli di skill incorporati; caricamento da `~/.squid/skills` e installazione da SkillHub e altre fonti
- Ruoli esperti incorporati e punti di estensione personalizzati

### Canali

- Canale WebUI integrato
- Canali estesi: `extensions/` e `~/.squid/extensions`, configurazione dichiarativa e bridge TaskAPI

### Claw e automazione

- Capacità HTTP Claw e progetto token in `src/claw`; se il servizio Claw sia abilitato di default nel desktop è definito in `src/bun/index.ts`
- Attività pianificate con node-cron e cronologia esecuzione

### Shell desktop

- Electrobun: processo principale Bun + WebView di sistema
- Layout principale, impostazioni, UI attività e sessione

## Test

Ultima registrazione automatizzata: 9 file di test, 31 casi superati (vedi [TEST_REPORT.md](../../TEST_REPORT.md)). Prima del rilascio eseguire `npm test` sull’ambiente di destinazione.

## Installazione e comandi (sorgente)

```bash
git clone <repository-url>
cd squid
npm install
npm test          # opzionale
npm run dev       # sviluppo desktop
npm run build     # tsc
npm run build:electron:release   # build desktop canale stabile (output in artifacts/)
```

## Configurazione

Primo avvio: in **Impostazioni** inserire le chiavi del modello e salvare. Canali e Feishu: [QUICK_START.md](../../QUICK_START.md), [channel-extensions.md](../../channel-extensions.md).

**Nota di build**: Electrobun **legge solo `electrobun.config.ts`**; se manca il file o si usa `.js`, il canale stabile potrebbe non copiare `public` e l’interfaccia resta bianca.

## Indice documentazione

- [user-guide.md](../../user-guide.md)
- [developer-guide.md](../../developer-guide.md)
- [TEST_REPORT.md](../../TEST_REPORT.md)
- [PROJECT_SUMMARY.md](../../PROJECT_SUMMARY.md)

## Sicurezza

- Verifica percorsi area di lavoro e classificazione permessi strumenti
- Archiviazione locale cifrata delle chiavi
- Il servizio HTTP locale non va esposto a Internet pubblica senza hardening

## Limitazioni note

- Parti dell’UI e dei selettori sono ancora in evoluzione (vedi Issue e milestone)
- Build macOS non firmate/non notarizzate possono attivare Gatekeeper; per la distribuzione si consiglia firma Developer ID e notarizzazione

## Roadmap (pianificazione)

- Completamento ecosistema skill e canali, impostazioni e osservabilità
- Ottimizzazioni prestazioni ed esperienza utente

## Licenza

MIT License

---

**Data di rilascio**: 2026-04-04 (aggiornata con la manutenzione del repository)  
**Versione**: v0.1.0  
**Stato**: in manutenzione
