# Compatibilité entre le plugin Feishu OpenClaw et squid

Ce document correspond à la tâche §1 du changement `integrate-feishu-openclaw-channel` ; les chemins sources de la tâche 1.1 permettent la traçabilité.

## 1.1 Références réelles à `openclaw/plugin-sdk/*` (extensions/feishu)

Les chemins ci-dessous proviennent d’un scan statique des fichiers `.ts` sous `openclaw-main/extensions/feishu` (`from "openclaw/..."`) :

| Chemin de module |
|------------------|
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

Le `package.json` à la racine déclare le paquet `@openclaw/feishu` avec une dépendance **peer** `openclaw >= 2026.3.27` ; la compilation et l’exécution supposent un hôte OpenClaw complet.

## 1.2 Comparaison avec le P0 de `docs/feishu-interfaces.md` (côté squid)

| Élément P0 | État squid |
|------------|------------|
| Envoi de messages (équivalent `sendMessageFeishu`) | **Présent** : `FeishuChannelPlugin` + HTTP plateforme Feishu (`im/v1/messages`) |
| Réception (Webhook) | **Présent** : `POST /api/feishu/webhook` → vérification de signature / déchiffrement → `submitFeishuInboundToEventBridge` |
| Configuration compte appId / appSecret | **Présent** : `~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config` (réponse masquée) |
| Contrôle d’état (équivalent `probeFeishu`) | **Partiel** : validité des identifiants via récupération de `tenant_access_token` |

## 1.3 Conclusion

- **Pas d’import direct utilisable tel quel** : le plugin officiel dépend massivement du `plugin-sdk` et du runtime OpenClaw, ce qui ne correspond pas au modèle de processus bureau Electrobun/Bun ; il faut un shim ou une réécriture de la couche protocole.
- **Couche d’adaptation / fine enveloppe viable** : squid utilise **l’API ouverte Feishu + `ChannelPlugin` + API d’entrée adaptateur → `EventBridge`**, sans embarquer le runtime du plugin Feishu OpenClaw.
- **À implémenter séparément** : liaison de session, cartes, carnet d’adresses, assistant d’appairage côté OpenClaw (P1/P2) ; un **shim de compatibilité** futur devrait réacheminer l’entrée d’origine vers `submitFeishuInboundToEventBridge` (voir `docs/openclaw-adapter.md`).

## 1.4 PoC optionnel

Aucun PoC d’exécution « instancier `@openclaw/feishu` » sur une branche isolée : l’analyse statique suffit à établir la surface de dépendances (§1.1). Un PoC éventuel devrait vivre dans un worktree séparé avec hôte OpenClaw et SDK alignés, en consignant la pile d’erreurs.

## 6. Revue de la spec `feishu-openclaw-compatibility` (tâche 5.3)

- **Documentation de l’évaluation** : le §1.3 conclut sur « adaptation ou implémentation autonome », le §1.1 cite au moins trois entrées OpenClaw.
- **Lacunes P0** : le §1.2 indique que le P0 est couvert par l’implémentation directe intégrée ou équivalente ; les écarts portent surtout sur les fonctions propres OpenClaw (session, cartes, etc., P1/P2).
- **Réutilisation directe du plugin** : le §1.3 dégrade l’attente vers une voie autonome ; il n’est pas affirmé que le paquet officiel se charge tel quel.
- **Shim et adaptateur** : l’implémentation actuelle est une **fine couche protocole** (pas un shim) ; la tâche 4.6 est **N/A** ; tout shim futur doit transiter par `submitFeishuInboundToEventBridge` (voir `docs/openclaw-adapter.md`).
