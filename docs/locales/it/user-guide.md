# Guida utente squid

Descrive le principali capacità e il flusso d’uso del desktop squid; in caso di divergenza valgono il codice e l’interfaccia della versione in esecuzione.

## Installazione e avvio

**Da sorgente**

```bash
cd squid
npm install
npm run dev
```

**Nota**: `npm run build` compila TypeScript; `npm start` esegue `node dist/main.js`, percorso diverso dal desktop Electrobun. Per lo sviluppo desktop quotidiano usare `npm run dev`.

**Pacchetti di rilascio**  
Installare o eseguire il binario per piattaforma; su macOS gestire avvisi di sicurezza come descritto nella [README del repository](../../../README.md).

## Impostazioni

Al primo utilizzo:

1. Aprire la barra laterale **Impostazioni**.
2. Configurare **Anthropic / OpenAI / endpoint compatibile** (chiavi, modello, Base URL se applicabile).
3. Salvare: la configurazione è scritta in `~/.squid/config.json`.

Opzionali: preferenze canali, UI, ecc. (secondo i gruppi effettivi della pagina Impostazioni).

## Attività e sessione

### Modalità attività

| Modalità | Caso d’uso |
|----------|------------|
| Ask | Consulenza, analisi in prevalenza sola lettura, modifiche minime all’area di lavoro |
| Craft | Catena strumenti automatica; possono essere creati o modificati file nell’area di lavoro |
| Plan | Compiti complessi: piano o passi prima dell’esecuzione confermata |

### Flusso di creazione (sintesi)

1. Scegliere **Nuova attività** o equivalente.
2. Selezionare modalità, modello e **directory di lavoro** (obbligatoria e attendibile).
3. Opzionale: skill, esperti.
4. Inserire l’istruzione in linguaggio naturale e inviare.

I percorsi fuori dall’area di lavoro sono in genere rifiutati dalla sandbox; non impostare directory di sistema sensibili come area di lavoro.

## Skill

- Skill predefinite e installate selezionabili nella creazione attività o nelle impostazioni.
- Contenuti in `~/.squid/skills/` (layout directory o singolo file secondo il loader).
- Installazione e metadati Tencent SkillHub: [tencent-skillhub.md](../../tencent-skillhub.md).

## Esperti

Modelli di ruolo incorporati per stile e confini professionali; centro esperti per consultazione e cambio. Estensioni esperto personalizzate secondo la versione corrente.

## Attività pianificate

1. Aprire la pagina **Attività pianificate**.
2. Nuova voce: espressione Cron, contenuto da passare al modello e altre opzioni.
3. Dopo l’abilitazione la pianificazione gira **solo con l’app in esecuzione**; chiusura dell’app sospende le esecuzioni.

Eventuali modelli predefiniti (riepilogo giornaliero, ispezione repository, ecc.) sono selezionabili dal wizard se presenti.

## Canali (Channel)

- **WebUI**: chat e attività principali, canale integrato verso il motore di esecuzione.
- **Canali estesi**: Feishu, Telegram, WeChat personale, ecc. in `extensions/` e `~/.squid/extensions/` con `channel-plugin.json`; abilitazione e moduli di configurazione in [channel-extensions.md](../../channel-extensions.md).

Lato Feishu servono app Open Platform, sottoscrizione eventi (long connection o Webhook) e file locale `~/.squid/feishu-channel.json`; in modalità HTTP l’URL eventi deve raggiungere la macchina locale. Dettagli in [QUICK_START.md](../../QUICK_START.md) e nella documentazione in `extensions/feishu`.

## Memoria

Memoria a lungo termine consultabile e modificabile in interfaccia dedicata; percorso sotto `~/.squid` definito dall’implementazione. In test la directory memoria può essere sovrascritta da variabile d’ambiente (vedi guida sviluppatore).

## Claw e API locale (avanzato)

- Il desktop incorpora **API HTTP locale** (comunicazione tipicamente same-machine) per esecuzione attività e streaming: non esporre su Internet pubblica senza protezioni.
- Il servizio HTTP Claw è in `src/claw`; se sia avviato di default nel flusso desktop dipende da `src/bun/index.ts`. Token, instradamento e chiamate remote: codice e test.

## Dati e backup

| Percorso | Contenuto |
|----------|-----------|
| `~/.squid/config.json` | Configurazione principale e chiavi modello |
| `~/.squid/skills/` | Skill |
| `~/.squid/channel-extensions.json` | Abilitazione estensioni canali lato utente |
| `~/.squid/extensions/` | Una delle radici estensioni utente |

Eseguire backup periodici dell’intera directory `~/.squid`; non versionare segreti.

## Domande frequenti

**Come cambiare il modello predefinito?**  
Nelle impostazioni modificare il default o, per singola attività, sovrascrivere nella creazione.

**È possibile accedere a file fuori dall’area di lavoro?**  
No per impostazione predefinita; vincoli da sandbox e permessi.

**Disinstallazione o migrazione?**  
Chiudere l’app, eseguire backup o eliminare `~/.squid`; in migrazione ripristinare la directory sulla nuova macchina e reinstallare l’applicazione.

## Documentazione correlata

- [QUICK_START.md](../../QUICK_START.md): percorso minimo  
- [developer-guide.md](../../developer-guide.md): sviluppo ed estensioni  
- [tool-development-guide.md](../../tool-development-guide.md): convenzioni strumenti  
- [TEST_REPORT.md](../../TEST_REPORT.md): report test  
