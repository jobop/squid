# Estensioni canale: direzione sandbox P1 (bozza, non implementata)

Il livello P0 offre solo **percorso attendibile + validazione manifest + isolamento fallimento singolo plugin**; il codice dell’estensione condivide lo spazio di indirizzamento con il processo principale. Di seguito opzioni evolutive per revisione e pianificazione.

## Obiettivo

Mantenendo invariata la **semantica di `ChannelPlugin`**, spostare fuori dal processo principale l’esecuzione in ingresso/uscita non attendibile o ad alto rischio, riducendo la superficie di esposizione.

## Opzione A: adattatore in sottoprocesso

- Il processo principale mantiene un leggero **client RPC**; la logica dell’estensione gira in un **sottoprocesso** Node/Bun, con messaggi JSON su `stdio` o socket locale.
- `ChannelPlugin.outbound.sendText`, ecc. lato host diventano chiamate RPC serializzate; nel sottoprocesso si invoca l’SDK reale.
- **Pro**: isolamento a livello OS, possibilità di limitare CPU/memoria (parzialmente per piattaforma).  
- **Contro**: latenza, complessità di deployment, sincronizzazione del ciclo di vita con l’uscita dell’app desktop.

## Opzione B: Worker thread

- Spostare calcolo puro o validazioni senza rete in `worker_threads` (se il supporto Bun è sufficiente).
- **Limite**: molti SDK di messaggistica istantanea richiedono il thread principale o moduli nativi; spesso resta necessaria l’opzione sottoprocesso.

## Opzione C: Isolate V8 / classi `isolated-vm`

- Isolamento leggero nello stesso processo; valutare **compatibilità Bun** e disponibilità API Node.
- Adatto a script **molto limitati**, non all’hosting diretto di SDK ufficiali di grandi dimensioni.

## Bozza interfaccia (RPC)

```text
Processo principale                    Sottoprocesso estensione
  |  spawn(channel-plugin.json)           |
  |----------------init------------------>|
  |<-------------ready--------------------|
  |  outbound.sendText(payload) -------->|
  |<------------- result ------------------|
```

L’involucro messaggio può includere `correlationId`, `channelId`, `method`, `payload`; gli errori riportano `code` + `message` (senza dati sensibili).

## Criteri di accettazione (futuri)

- Il crash di un sottoprocesso non deve terminare il processo principale; all’uscita dell’host inviare SIGTERM al sottoprocesso e, se necessario, SIGKILL entro timeout.  
- Timeout RPC e quote configurabili (dimensione messaggio, QPS) per estensione.

La milestone attuale resta ancorata alla documentazione e configurazione P0; l’implementazione di questa pagina richiede OpenSpec / revisione progettuale dedicata.
