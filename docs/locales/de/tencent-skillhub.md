# Tencent SkillHub-Integration

## Funktionsüberblick

Aktuelle Version: grundlegende Anbindung an Tencent SkillHub:

- Skill-Katalog mit Stichwortsuche  
- Installationsstatus (nicht installiert / installiert / aktualisierbar)  
- Ein-Klick-Installation ins lokale Skill-Verzeichnis  

## Backend-Endpunkte

### 1) SkillHub-Liste abfragen

- `GET /api/skillhub/tencent/skills`  
- Query:  
  - `query` (optional): Suchbegriff  
  - `limit` (optional): Anzahl, Standard `20`  

Beispielantwort:

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

### 2) Skill installieren

- `POST /api/skillhub/tencent/install`  
- Body:  
  - `slug` (Pflicht)  
  - `version` (optional, sonst neueste)  
  - `force` (optional, Neuinstallation erzwingen)  

Beispielantwort:

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## Konfiguration

Priorität (höchste zuerst):

1. Umgebungsvariablen:  
   - `TENCENT_SKILLHUB_BASE_URL`  
   - `TENCENT_SKILLHUB_TOKEN`  
2. `~/.squid/config.json`:  
   - `model.skillhub.tencent.baseUrl` / `model.skillhub.tencent.token`  
   - oder `model.tencentSkillHub.baseUrl` / `token`  
3. Standard-Basis-URL: `https://skillhub.tencent.com/api/v1`  

## Lokale Metadaten

Installationsherkunft und Lock-Dateien:

- `~/.squid/skillhub/tencent/lock.json`  
- `~/.squid/skillhub/tencent/origins/<slug>.json`  

## Fehlerbehebung

- **Leere Liste**: `baseUrl` erreichbar? Suchbegriff zu eng?  
- **Installation schlägt fehl (Paketstruktur)**: Paket muss `SKILL.md` enthalten.  
- **Doppelinstallation**: `force: true` oder lokales Verzeichnis des Skills löschen.  
