# Kompatibilität: OpenClaw-Feishu-Plugin und squid

Dieses Dokument gehört zur Änderung `integrate-feishu-openclaw-channel`, Aufgabe §1; Quellpfade lassen sich über Aufgabe 1.1 nachvollziehen.

## 1.1 Tatsächliche `openclaw/plugin-sdk/*`-Importe (extensions/feishu)

Die folgenden Pfade stammen aus einer statischen Analyse der `.ts`-Quellen unter `openclaw-main/extensions/feishu` (`from "openclaw/..."`):

| Modulpfad |
|-----------|
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

Die `package.json` im Stamm deklariert das Paket als `@openclaw/feishu` mit **Peer**-Abhängigkeit `openclaw >= 2026.3.27`; Build und Laufzeit setzen einen vollständigen OpenClaw-Host voraus.

## 1.2 Abgleich mit [feishu-interfaces.md](./feishu-interfaces.md) P0 (squid-Seite)

| P0-Punkt | Status in squid |
|----------|-----------------|
| Nachrichten senden (Äquivalent zu `sendMessageFeishu`) | **Vorhanden**: `FeishuChannelPlugin` + Feishu Open Platform HTTP (`im/v1/messages`) |
| Nachrichten empfangen (Webhook) | **Vorhanden**: `POST /api/feishu/webhook` → Signatur/Entschlüsselung → `submitFeishuInboundToEventBridge` |
| Kontokonfiguration appId / appSecret | **Vorhanden**: `~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config` (Antworten ohne Klartext-Secrets) |
| Statusprüfung (Äquivalent `probeFeishu`) | **Teilweise**: Gültigkeit der Credentials über Abruf von `tenant_access_token` |

## 1.3 Fazit

- **Nicht direkt per import nutzbar**: Das offizielle Plugin hängt stark an `plugin-sdk` und der OpenClaw-Laufzeitumgebung; das passt nicht 1:1 zum Electrobun/Bun-Desktop-Prozessmodell – Shim oder Neuimplementierung der Protokollschicht nötig.
- **Adapter / dünne Hülle möglich**: squid nutzt **direkte Anbindung an die Feishu Open Platform + `ChannelPlugin` + Adapter-Inbound-API → `EventBridge`**, ohne eingebettete OpenClaw-Feishu-Laufzeit.
- **Separat zu implementieren**: OpenClaw-seitige Sitzungsbindung, Karten, Adressbuch, Pairing-Assistenten usw. (P1/P2); ein künftiger **Kompatibilitäts-Shim** sollte den ursprünglichen Inbound-Pfad nach `submitFeishuInboundToEventBridge` weiterleiten (siehe [openclaw-adapter.md](./openclaw-adapter.md)).

## 1.4 Optionaler PoC

Es wurde kein Laufzeit-PoC mit instanziiertem `@openclaw/feishu` auf einem isolierten Branch durchgeführt: Die statische Analyse in §1.1 belegt die Symbolabhängigkeiten. Für einen PoC sollten Host und Plugin-SDK in einem separaten Worktree mit Fehlerstacks dokumentiert werden.

## 6. Spec-Walkthrough `feishu-openclaw-compatibility` (Aufgabe 5.3)

- **Bewertung dokumentiert**: §1.3 fasst die Schlussfolgerung „Adapter oder Eigenimplementierung“ zusammen; §1.1 listet die OpenClaw-Symbole (≥ 3).
- **P0-Lücken**: §1.2 zeigt, dass P0 auf squid-Seite durch eingebaute Direktanbindung bzw. Äquivalente abgedeckt ist; Lücken betreffen vor allem OpenClaw-spezifische Sitzung/Karten usw. (P1/P2).
- **Direkte Plugin-Wiederverwendung**: §1.3 stuft auf Eigenimplementierung ab; es wird nicht behauptet, das offizielle Plugin-Paket könne unverändert geladen werden.
- **Shim und Adapter**: Die aktuelle Lösung ist eine **dünne Protokoll-Hülle** (kein Shim); Aufgabe 4.6 **N/A**; ein künftiger Shim muss nach `submitFeishuInboundToEventBridge` weiterleiten (siehe [openclaw-adapter.md](./openclaw-adapter.md)).
