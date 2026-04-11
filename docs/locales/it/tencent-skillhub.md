# Integrazione Tencent SkillHub

## Panoramica funzionale

La versione corrente introduce il supporto base a Tencent SkillHub:

- Catalogo skill con ricerca per parola chiave
- Stato installazione (non installata / installata / aggiornabile)
- Installazione in un clic nella directory skill locale

## API backend

### 1) Elenco skill Tencent SkillHub

- `GET /api/skillhub/tencent/skills`
- Query:
  - `query` (opzionale): parola chiave di ricerca
  - `limit` (opzionale): numero massimo elementi, predefinito `20`

Esempio di risposta:

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

### 2) Installazione skill da Tencent SkillHub

- `POST /api/skillhub/tencent/install`
- Body:
  - `slug` (obbligatorio): identificativo skill
  - `version` (opzionale): versione specifica; se omessa si usa l’ultima
  - `force` (opzionale): sovrascrivere installazione esistente

Esempio di risposta:

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## Configurazione

Fonti supportate (priorità decrescente):

1. Variabili d’ambiente:
   - `TENCENT_SKILLHUB_BASE_URL`
   - `TENCENT_SKILLHUB_TOKEN`
2. In `~/.squid/config.json`:
   - `model.skillhub.tencent.baseUrl`
   - `model.skillhub.tencent.token`
   - oppure `model.tencentSkillHub.baseUrl` / `token`
3. URL predefinito: `https://skillhub.tencent.com/api/v1`

## Metadati locali

Origine installazione e file di lock:

- `~/.squid/skillhub/tencent/lock.json`
- `~/.squid/skillhub/tencent/origins/<slug>.json`

## Risoluzione problemi

- **Elenco vuoto**: verificare raggiungibilità di `baseUrl` e che la query non sia troppo restrittiva.
- **Installazione fallita (struttura pacchetto non valida)**: il pacchetto da SkillHub deve contenere `SKILL.md`.
- **Reinstallazione bloccata**: usare `force: true` oppure rimuovere manualmente la directory skill locale omonima.
