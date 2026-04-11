# Совместимость плагина OpenClaw Feishu с squid

Документ относится к изменению `integrate-feishu-openclaw-channel`, задача §1; исходные пути см. в задаче 1.1.

## 1.1 Фактические импорты `openclaw/plugin-sdk/*` (extensions/feishu)

Ниже — статический обзор импортов `from "openclaw/..."` в `.ts` в `openclaw-main/extensions/feishu`:

| Путь модуля |
|-------------|
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

В корневом `package.json` пакет объявлен как `@openclaw/feishu` с **peer**‑зависимостью `openclaw >= 2026.3.27`; сборка и запуск предполагают полноценный хост OpenClaw.

## 1.2 Сверка с P0 в [feishu-interfaces.md](./feishu-interfaces.md) (сторона squid)

| Пункт P0 | Состояние в squid |
|----------|-------------------|
| Отправка сообщений (аналог `sendMessageFeishu`) | **Есть**: `FeishuChannelPlugin` + HTTP Feishu Open Platform (`im/v1/messages`) |
| Приём сообщений (Webhook) | **Есть**: `POST /api/feishu/webhook` → проверка подписи/расшифровка → `submitFeishuInboundToEventBridge` |
| Конфигурация аккаунта appId / appSecret | **Есть**: `~/.squid/feishu-channel.json` + `GET/POST /api/channels/feishu/config` (секреты в ответе маскируются) |
| Проверка состояния (аналог `probeFeishu`) | **Частично**: валидность учётных данных проверяется через получение `tenant_access_token` |

## 1.3 Выводы

- **Нельзя просто импортировать и использовать**: официальный плагин тянет большой `plugin-sdk` и рантайм OpenClaw, что не совпадает с моделью процесса Electrobun/Bun на десктопе; нужен shim или переписанный протокольный слой.
- **Подходит тонкий адаптер / обёртка**: в squid используется **прямое подключение к Feishu Open Platform + `ChannelPlugin` + inbound API адаптера → `EventBridge`**, без встраивания рантайма плагина Feishu OpenClaw.
- **Требуется самостоятельная реализация**: привязка сессий OpenClaw, карточки, контакты, мастер сопряжения и прочие возможности P1/P2; если в будущем понадобится **совместимый shim**, исходный путь приёма следует проксировать в `submitFeishuInboundToEventBridge` (см. [openclaw-adapter.md](./openclaw-adapter.md)).

## 1.4 Опциональный PoC

Изолированный PoC с инстанцированием `@openclaw/feishu` в рантайме не выполнялся: статический анализ уже показывает поверхность зависимостей (§1.1). При необходимости PoC следует проводить в отдельном worktree с подтянутым хостом `openclaw` и SDK, фиксируя стек ошибок.

## 6. Проходка спеки `feishu-openclaw-compatibility` (задача 5.3)

- **Зафиксированная оценка**: §1.3 классифицирует исход как «нужна адаптация или самостоятельная реализация»; §1.1 перечисляет ≥3 пункта опоры на символы OpenClaw.
- **Пробелы P0**: §1.2 отмечает, что P0 закрыт встроенной прямой интеграцией или эквивалентом; основные пробелы — специфичные для OpenClaw сессии/карточки и т.д. (P1/P2).
- **Прямое переиспользование плагина**: §1.3 снижает ожидания до пути самостоятельной реализации; прямой загрузки официального пакета не заявлено.
- **Shim и Adapter**: текущая реализация — **тонкий протокольный слой** (не shim); задача 4.6 помечена как **N/A**; при появлении shim вход должен проксироваться в `submitFeishuInboundToEventBridge` (см. [openclaw-adapter.md](./openclaw-adapter.md)).
