# Guida rapida a squid

Destinatari: utenti finali che installano ed eseguono squid in locale, configurano il modello e iniziano a conversare e usare le attività. Architettura ed estensioni: [developer-guide.md](../../developer-guide.md).

## Posizionamento prodotto

squid è una **postazione di lavoro AI desktop in esecuzione locale**, adatta a:

- Leggere, revisionare e modificare in modo leggero il codice nella directory di lavoro indicata (secondo modalità attività e sandbox)
- Combinare skill ed esperti per documentazione, ricerca e output strutturato
- Usare attività pianificate con Cron sul computer locale
- Abilitare **estensioni canale** come Feishu, Telegram, WeChat (configurazione separata; vedi [channel-extensions.md](../../channel-extensions.md))

## Ambiente e avvio

**Da sorgente (consigliato agli sviluppatori)**

- Node.js 22 LTS consigliato, npm; il desktop dipende da Electrobun (la CLI viene preparata per piattaforma con `npm run dev`).
- Alla radice del progetto deve esistere **`electrobun.config.ts`** (Electrobun legge solo questo nome file).

```bash
cd squid
npm install
npm run dev
```

**Pacchetti di rilascio**

Se si usa una build da GitHub Release, seguire le istruzioni per piattaforma. Su macOS le build non firmate possono richiedere «Apri» dal menu contestuale o un’eccezione in Preferenze di Sistema; dettagli nella [README alla radice del repo](../../../README.md).

## Configurazione delle chiavi API

Configurare almeno un fornitore di modelli (in **Impostazioni** nell’app; le chiavi sono scritte in `~/.squid/config.json` sul computer locale):

| Fornitore | Note |
|-----------|------|
| Anthropic | API Key dalla [Anthropic Console](https://console.anthropic.com/) |
| OpenAI | API Key dalla [OpenAI Platform](https://platform.openai.com/) |
| Endpoint compatibile | Base URL e nome modello personalizzati nelle impostazioni (deve essere compatibile con il protocollo usato dall’app) |

## Primo utilizzo

1. Dopo l’avvio apri la barra laterale **Impostazioni** e salva modello e opzioni.
2. Nell’interfaccia chat o attività **seleziona la directory di lavoro** (non usare percorsi non attendibili come radice).
3. **Crea una nuova sessione o attività** e scegli la modalità:
   - **Ask**: prevalenza analisi in sola lettura, senza riscrittura file di default (comportamento effettivo dipende dalla versione).
   - **Craft**: consente l’esecuzione automatica della catena strumenti; possono essere modificati file nell’area di lavoro.
   - **Plan**: orientata a pianificazione e passi, adatta a esigenze complesse.
4. Opzionalmente seleziona **skill** o **esperti**.

## Canali e Feishu (opzionale)

- La barra laterale **Canali** mostra WebUI integrato e lo stato delle estensioni.
- L’implementazione Feishu è in `extensions/feishu/`; l’abilitazione predefinita in `config/channel-extensions.json` dipende dal repository. Lato utente l’elenco abilitato può stare in `~/.squid/channel-extensions.json`.
- Estensioni personali o di terze parti in `~/.squid/extensions/<cartella>/`; dettagli in [channel-extensions.md](../../channel-extensions.md).

Creazione bot Feishu, long polling/Webhook e campi di `~/.squid/feishu-channel.json` restano descritti nell’app e in [user-guide.md](../../user-guide.md).

## Esempi di attività comuni

**Revisione codice (Ask)**

```text
Modalità: Ask
Directory di lavoro: <percorso del progetto>
Istruzione: riassumi le responsabilità dei moduli principali in src e segnala problemi di leggibilità o difetti evidenti.
```

**Documentazione in batch (Craft)**

```text
Modalità: Craft
Directory di lavoro: <percorso del progetto>
Istruzione: genera una bozza Markdown delle API pubbliche nella directory indicata.
```

**Attività pianificate**

Nella pagina **Attività pianificate** crea una voce con espressione Cron e il contenuto da passare al modello; se l’app non è in esecuzione la pianificazione non viene eseguita.

## Skill ed esperti

- **Skill**: seleziona dall’interfaccia le skill installate; i file sono in `~/.squid/skills/` (inclusi installazioni da SkillHub e altre fonti).
- **Esperti**: regolano ruolo di sistema e confini; gestione nelle pagine dedicate agli esperti.

## Domande frequenti

**Le chiavi restano solo sul computer locale?**  
Sì. Non committare configurazione o segreti; eseguire backup di `~/.squid`.

**Le attività modificano i file?**  
Dipende dalla modalità e dalla policy strumenti: Ask tende alla sola lettura; Craft può scrivere; Plan spesso spiega prima di eseguire. Seguire i prompt dell’interfaccia.

**Confini della directory di lavoro?**  
Gli strumenti su file sono in genere limitati alla directory associata alla sessione; i dettagli sono nella sandbox e nel motore permessi.

**Come interrompere un’attività in corso?**  
Usare il controllo Stop/Interrompi nell’interfaccia attività o sessione (etichetta dipende dall’UI).

**Le attività pianificate girano a app chiusa?**  
No: la pianificazione richiede il processo applicativo attivo.

## Approfondimenti

| Documento | Contenuto |
|-----------|-----------|
| [user-guide.md](../../user-guide.md) | Funzioni e interfaccia |
| [developer-guide.md](../../developer-guide.md) | Struttura directory ed estensioni |
| [tool-development-guide.md](../../tool-development-guide.md) | Convenzioni strumenti integrati |
| [TEST_REPORT.md](../../TEST_REPORT.md) | Panoramica test automatizzati |

Segnalazioni e contributi tramite Issue / Pull Request del repository.
