# Compatibilità tra il plugin Feishu OpenClaw e squid

Questo documento corrisponde al task §1 della modifica `integrate-feishu-openclaw-channel`; i percorsi sorgente sono tracciabili dal task 1.1.

## 1.1 Riferimenti effettivi a `openclaw/plugin-sdk/*` (extensions/feishu)

I percorsi seguenti derivano da un’analisi statica dei file `.ts` in `openclaw-main/extensions/feishu` (`from "openclaw/..."`):

| Percorso modulo |
|-----------------|
| `openclaw/plugin-sdk/account-helpers` |
| `openclaw/plugin-sdk/account-id` |
| `openclaw/plugin-sdk/account-resolution` |
| `openclaw/plugin-sdk/allow-from` |
| `openclaw/plugin-sdk/channel-actions` |
| `openclaw/plugin-sdk/channel-config-helpers` |
| `openclaw/plugin-sdk/channel-contract` |
| `openclaw/plugin-sdk/channel-pairing` |
| `openclaw/plugin-sdk/channel-policy` |
| `openclaw/plugin-sdk/channel-send-result` |
| `openclaw/plugin-sdk/config-runtime` |
| `openclaw/plugin-sdk/conversation-runtime` |
| `openclaw/plugin-sdk/core` |
| `openclaw/plugin-sdk/directory-runtime` |
| `openclaw/plugin-sdk/feishu` |
| `openclaw/plugin-sdk/lazy-runtime` |
| `openclaw/plugin-sdk/media-runtime` |
| `openclaw/plugin-sdk/outbound-runtime` |
| `openclaw/plugin-sdk/reply-payload` |
| `openclaw/plugin-sdk/routing` |
| `openclaw/plugin-sdk/runtime-store` |
| `openclaw/plugin-sdk/secret-input` |
| `openclaw/plugin-sdk/setup` |
| `openclaw/plugin-sdk/status-helpers` |
| `openclaw/plugin-sdk/text-runtime` |
| `openclaw/plugin-sdk/webhook-ingress` |
| `openclaw/plugin-sdk/zod` |

Il `package.json` alla radice dichiara il pacchetto come `@openclaw/feishu` con dipendenza **peer** `openclaw >= 2026.3.27`; build ed esecuzione presuppongono un host OpenClaw completo.

## 1.2 Confronto con P0 in `../../feishu-interfaces.md` (lato squid)

| Voce P0 | Stato in squid |
|---------|-----------------|
| Invio messaggi (equivalente `sendMessageFeishu`) | **Presente**: `FeishuChannelPlugin` + HTTP Feishu Open Platform (`im/v1/messages`) |
| Ricezione messaggi (Webhook) | **Presente**: `POST /api/feishu/webhook` → verifica firma/decifratura → `submitFeishuInboundToEventBridge` |
| Configurazione account appId / appSecret | **Presente**: `~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config` (risposta con dati sensibili mascherati) |
| Controllo stato (equivalente `probeFeishu`) | **Parziale**: validità credenziali tramite recupero `tenant_access_token` |

## 1.3 Conclusioni

- **Non importabile così com’è**: il plugin ufficiale dipende da numerosi moduli `plugin-sdk` e dal runtime OpenClaw, incompatibile col modello di processo desktop Electrobun/Bun; servono shim o reimplementazione del livello protocollo.
- **Adattatore / sottile incapsulamento**: squid usa **connessione diretta all’Open Platform Feishu + `ChannelPlugin` + API Adapter in ingresso → `EventBridge`**, senza incorporare il runtime del plugin Feishu OpenClaw.
- **Da implementare in modo autonomo**: binding sessione, schede, rubrica, wizard di pairing lato OpenClaw (P1/P2); un futuro **shim di compatibilità** dovrebbe inoltrare il percorso in ingresso originale a `submitFeishuInboundToEventBridge` (vedi `../../openclaw-adapter.md`).

## 1.4 PoC opzionale

Non è stato eseguito in branch isolato un PoC «istanziare `@openclaw/feishu`» a runtime: l’analisi statica dimostra già la superficie di dipendenze (§1.1). Un PoC andrebbe documentato in un worktree separato con host OpenClaw e SDK allineati, registrando lo stack di errori.

## 6. Walkthrough spec `feishu-openclaw-compatibility` (task 5.3)

- **Valutazione documentata**: §1.3 classifica l’esito come «adattamento o implementazione autonoma»; §1.1 elenca le prove simboliche OpenClaw (≥3 voci).
- **Lacune P0**: §1.2 indica che P0 è coperto dall’implementazione diretta integrata o equivalente; le lacune principali riguardano sessioni/schede proprietarie OpenClaw (P1/P2).
- **Riutilizzo diretto del plugin**: §1.3 declassa verso implementazione autonoma; non si afferma il caricamento diretto del pacchetto ufficiale.
- **Shim e Adapter**: l’implementazione attuale è un **sottile livello protocollo** (non shim); il task 4.6 è **N/A**; un futuro shim deve inoltrare a `submitFeishuInboundToEventBridge` (vedi `../../openclaw-adapter.md`).
