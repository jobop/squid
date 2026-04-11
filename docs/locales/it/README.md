# squid

squid è una **postazione di lavoro AI desktop** eseguita in locale: conversi con il modello nella finestra dell’app, gestisci più sessioni, assegni una directory di lavoro a ciascuna sessione e, dalle impostazioni, colleghi Anthropic, OpenAI o endpoint compatibili. Competenze (skill), memoria, attività pianificate e canali come Feishu, Telegram, WeChat (da abilitare e configurare nell’app) condividono la stessa pipeline di elaborazione. Configurazione e dati predefiniti risiedono in **`~/.squid`** sul computer locale.

**Versione**: 0.1.0  
**Licenza**: MIT

---

## Cosa puoi fare

- **Chat multi-sessione**: organizza le conversazioni per thread e associa una directory di lavoro per porre domande su progetti specifici o far leggere/scrivere file entro i limiti consentiti.
- **Modalità di lavoro**: nell’interfaccia scegli **Ask** (consulenza e analisi prevalentemente in sola lettura), **Craft** (catena di strumenti eseguibile), **Plan** (pianificazione e scomposizione); il comportamento effettivo segue le descrizioni in-app.
- **Modelli e chiavi**: in **Impostazioni** inserisci API Key, nome modello e URL endpoint personalizzato; le chiavi restano solo sulla macchina locale e non sono distribuite col repository.
- **Skill**: dall’app sfoglia, installa e gestisci le skill (anche da Tencent SkillHub); i contenuti installati si trovano in `~/.squid/skills`.
- **Esperti e memoria**: usa esperti predefiniti o personalizzati per stile e confini dell’assistente; la memoria a lungo termine è consultabile e gestibile separatamente.
- **Attività pianificate**: trigger locali con espressioni Cron che inviano contenuti al modello e conservano la cronologia di esecuzione.
- **Canali**: oltre all’interfaccia principale puoi abilitare Feishu, Telegram, account WeChat personale, ecc. (configurazione nei canali; alcuni richiedono login o webhook aggiuntivi; vedi `docs` e la documentazione del canale).

---

## Installazione e avvio

**Da sorgente (sviluppatori o build manuale)**

- Servono **Node.js** (consigliato 22 LTS) e **npm**; il desktop dipende da **Electrobun**, con supporto macOS 14+, Windows 11+ e gli ambienti Linux indicati nella documentazione ufficiale.
- Dopo il clone, dalla radice del progetto:

```bash
cd squid
npm install
npm run dev
```

**Pacchetti di rilascio**

- Se sono disponibili release su GitHub, scarica il binario per il tuo sistema, installa o estrai ed esegui; su macOS le build non firmate/non notarizzate possono essere bloccate al primo avvio: in **Privacy e sicurezza** concedi l’apertura se appropriato.

---

## Primi passi consigliati

1. Apri **Impostazioni**, configura modello e (se serve) i canali, poi salva.  
2. Nell’area chat **scegli la directory di lavoro** (non usare directory non attendibili come area di lavoro).  
3. **Crea una nuova sessione** e prova una richiesta breve; per l’automazione passa poi a skill, pianificazioni o canali.

Per i dettagli dell’interfaccia vedi **[../../QUICK_START.md](../../QUICK_START.md)** e **[../../user-guide.md](../../user-guide.md)**.  
Per la documentazione multilingua (ZH/EN/JA/RU/IT/FR/DE) apri **[../../index.html](../../index.html)** e cambia lingua.

---

## Dove vengono salvati i dati

| Percorso | Significato per l’utente |
|----------|---------------------------|
| `~/.squid/config.json` | Configurazione principale: chiavi modello, preferenze UI e alcuni flag di funzionalità |
| `~/.squid/skills/` | File delle skill installate |
| Altri JSON sotto `~/.squid` | Configurazione e dati per canali, memoria, ecc. (generati con l’uso) |

Esegui backup di questa directory; non committare file con segreti su repository pubblici. Per alcune estensioni (es. WeChat personale) potrebbe servire **`npm run weixin-personal:login`** dalla directory sorgente dell’estensione: segui la documentazione dell’estensione.

---

## Avvisi di sicurezza

- Se l’assistente ha strumenti su file o comandi, l’ambito è vincolato dalla **directory di lavoro** e dalle regole integrate; non impostare directory di sistema sensibili come area predefinita.  
- L’app espone servizi locali per la comunicazione tra UI e processo principale; in uso normale non apre attivamente LAN o Internet pubblica. Se configuri port forwarding o reverse proxy, gestisci autenticazione e controllo accessi.

---

## Sviluppo da sorgente (sintesi)

squid usa **Electrobun**: processo principale e servizio locale lato Bun, interfaccia nel WebView di sistema. Se sviluppi dalla **radice del clone** e vuoi caricare le estensioni canale incluse nel repo, imposta **`SQUID_ROOT`** sulla radice del repository (per trovare `config/channel-extensions.json`); gli utenti delle build installate non ne hanno bisogno. Moduli, estensioni e convenzioni sugli strumenti: **[../../developer-guide.md](../../developer-guide.md)** e **[../../tool-development-guide.md](../../tool-development-guide.md)**.

---

## Altra documentazione

| Documento | Per chi |
|-----------|---------|
| [../../QUICK_START.md](../../QUICK_START.md) | Avvio rapido delle funzioni |
| [../../user-guide.md](../../user-guide.md) | Panoramica su menu e capacità |
| [../../developer-guide.md](../../developer-guide.md) | Sviluppo ed estensioni |
| [../../tool-development-guide.md](../../tool-development-guide.md) | Strumenti integrati |
| [../../RELEASE_NOTES.md](../../RELEASE_NOTES.md) | Note di versione |
| [../../TEST_REPORT.md](../../TEST_REPORT.md) | Test e qualità |

---

## Licenza

Questo progetto è distribuito sotto **MIT License**.
