# Интеграция Tencent SkillHub

## Возможности

В текущей версии добавлена базовая поддержка Tencent SkillHub:

- каталог skills с поиском по ключевым словам;
- отображение статуса установки (не установлен / установлен / доступно обновление);
- установка в локальный каталог skills одним действием.

## HTTP API

### 1) Список skills SkillHub

- `GET /api/skillhub/tencent/skills`
- Query:
  - `query` (опционально): строка поиска
  - `limit` (опционально): лимит, по умолчанию `20`

Пример ответа:

```json
{
  "success": true,
  "skills": [
    {
      "slug": "demo-skill",
      "name": "Demo Skill",
      "description": "Demo",
      "latestVersion": "1.0.0",
      "installStatus": "not_installed",
      "installedVersion": null
    }
  ],
  "total": 1
}
```

### 2) Установка skill

- `POST /api/skillhub/tencent/install`
- Body:
  - `slug` (обязательно)
  - `version` (опционально): конкретная версия, иначе последняя
  - `force` (опционально): перезапись существующей установки

Пример ответа:

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## Конфигурация

Источники (от высшего приоритета к низшему):

1. Переменные окружения:  
   - `TENCENT_SKILLHUB_BASE_URL`  
   - `TENCENT_SKILLHUB_TOKEN`  
2. В `~/.squid/config.json`:  
   - `model.skillhub.tencent.baseUrl`  
   - `model.skillhub.tencent.token`  
   - или `model.tencentSkillHub.baseUrl` / `token`  
3. Значение по умолчанию: `https://skillhub.tencent.com/api/v1`

## Локальные метаданные

После установки:

- `~/.squid/skillhub/tencent/lock.json`
- `~/.squid/skillhub/tencent/origins/<slug>.json`

## Устранение неполадок

- **Пустой список:** проверьте доступность `baseUrl` и не слишком узкий поисковый запрос.  
- **Ошибка установки (неверная структура пакета):** в архиве должен быть `SKILL.md`.  
- **Повторная установка:** `force: true` или удалите локальный каталог skill с тем же именем.  
