# Estensioni canale (caricamento dinamico)

## Modello di fiducia P0 (obbligatorio)

Le estensioni usano **`import()` dinamico** di Bun nello **stesso processo** del processo principale: **non** c’è isolamento in sandbox di memoria. Installare e configurare **solo estensioni attendibili** (fonte verificabile e auditabile). Senza `roots` configurati non viene caricata alcuna estensione; **Feishu** è fornita nel repo in `extensions/feishu/` e di solito è caricata con `enabled: ["feishu"]` in `config/channel-extensions.json` (in pagina Canali la fonte risulta «estensione»).

Priorità e conflitti:

- **Integrato**: solo WebUI; **Feishu** e le altre estensioni passano dal loader. Le estensioni **non possono sovrascrivere** un `id` già registrato (WebUI integrato `webui` prima delle estensioni): in conflitto l’estensione viene ignorata e l’errore compare in `errors` di `GET /api/channels`.
- Se due pacchetti estensione dichiarano lo stesso `id`, **vince il primo registrato con successo**, il secondo viene ignorato.

## Struttura pacchetto

Ogni plugin è una sottodirectory; la directory padre è indicata da `roots` nella configurazione:

```text
<root>/
  my-plugin/
    channel-plugin.json
    plugin.ts        # oppure .js; come da campo main
```

### channel-plugin.json

| Campo | Descrizione |
|-------|-------------|
| `id` | Identificatore univoco, deve coincidere con `ChannelPlugin.id` restituito dalla factory |
| `name` | Nome visualizzato |
| `version` | Stringa di versione |
| `main` | Entry ESM relativa alla directory del plugin, non assoluta e senza `..` |
| `capabilities` / `permissions` | Opzionali, riservati |

### Modulo di ingresso

È richiesta **export default** o export nominato **`createChannelPlugin`**: factory che restituisce `ChannelPlugin` o `Promise<ChannelPlugin>`.

L’interfaccia è definita in `src/channels/types.ts` (`config`, `outbound`, `status` obbligatori; `setup` consigliato per long-lived connection, ecc.).

## Configurazione

Fusione di due sorgenti (se entrambe esistono si uniscono le `roots`; **`enabled` ha priorità in `~/.squid/channel-extensions.json`**):

1. `squid/config/channel-extensions.json` (creabile partendo da `config/channel-extensions.example.json`)
2. `~/.squid/channel-extensions.json`

Campi:

- **`roots`**: `string[]`, ogni elemento è un **percorso padre** che contiene **più sottodirectory di plugin**. Può essere assoluto o relativo alla **radice del repository squid**.
- **`enabled`** (opzionale): se omesso o `null`, si tenta il caricamento di tutti i candidati validi; se `[]`, nessuna estensione; se array non vuoto, **solo** gli `id` elencati.

### Directory utente `~/.squid/extensions` (non serve aggiungerla a `roots`)

Se esiste **`~/.squid/extensions`**, viene **automaticamente** unita come radice di scansione alle `roots` sopra (se assente viene ignorata senza errore). I plugin personali possono stare ad es. in `~/.squid/extensions/my-plugin/channel-plugin.json`. Il caricamento resta soggetto al **`enabled`** (es. con default solo `feishu` occorre aggiungere l’`id` del plugin personalizzato in `~/.squid/channel-extensions.json` o nella configurazione di progetto).

Dopo la modifica della configurazione è necessario **riavviare** il processo host.

## Esempio

Il repository include `extensions/example-echo-channel/`. In `config/channel-extensions.json`:

```json
{
  "roots": ["extensions"],
  "enabled": ["echo-demo"]
}
```

Dopo il riavvio, nella barra laterale **Canali** dovrebbe comparire `echo-demo` con fonte «estensione».

## API

- `GET /api/channels` restituisce `{ "channels": [...], "errors": [...] }`. Ogni canale ha `source`: `"builtin"` | `"extension"`. `errors` elenca errori non fatali di scansione/caricamento (senza segreti).

## Debug locale

1. Creare sottodirectory sotto `roots` con `channel-plugin.json`.  
2. Con TypeScript come ingresso, assicurarsi che il caricamento avvenga tramite **Bun** (backend desktop attuale).  
3. Consultare i log console `[ChannelExtensions]` e il banner arancione in cima all’UI.

## Sessione occupata, coda e risposta (senza estendere ulteriormente `QueuedCommand`)

Come per Feishu / Telegram, un nuovo canale che deve **in coda, al termine, inviare la risposta dell’assistente alla stessa conversazione**:

1. In **`setup.initialize`**, se il contesto factory espone **`ctx.taskAPI`** (iniettato quando l’host chiama `initializeBuiltinChannels(taskAPI)`), registrare **`registerXxxSquidBridge(ctx.taskAPI)`** (o equivalente) e nel bridge chiamare **`taskAPI.addChannelQueuedCompleteHandler(...)`**, inviando messaggi solo se `cmd.channelReply?.channelId === '<il tuo channel id>'`; in **`setup.cleanup`** invocare la funzione di teardown restituita dal bridge. **L’host non deve** importare per ogni canale `registerXxxSquidBridge`.
2. Con sessione occupata usare **`enqueueFromRequest(..., { channelReply: { channelId: '<come sopra>', chatId: '<chiave di routing>' } })`**. `chatId` è una stringa opaca per il canale.

I tipi sono in `src/utils/messageQueueManager.ts` (**`ChannelQueueReply`**). Non aggiungere al core nuovi campi `xxxChatId`.

## Rapporto con i contributi integrati

- **Integrato**: si può ancora contribuire con PR in `src/channels` e registrazione in `initializeBuiltinChannels`.  
- **Estensione**: adatta a plugin privati o sperimentali senza modificare il registry centrale; la responsabilità sulla sicurezza spetta alla configurazione di deployment e alla fonte dell’estensione.
