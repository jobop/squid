# Tencent SkillHub integration

## Feature summary

This release adds baseline Tencent SkillHub support:

- Skill catalog browsing (keyword search)  
- Install state (`not_installed` / `installed` / `update_available`)  
- One-click install into the local skills directory  

## HTTP API

### 1) List SkillHub skills

- `GET /api/skillhub/tencent/skills`  
- Query parameters:  
  - `query` (optional): search string  
  - `limit` (optional): page size, default `20`  

Example response:

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

### 2) Install a SkillHub skill

- `POST /api/skillhub/tencent/install`  
- Body:  
  - `slug` (required): skill identifier  
  - `version` (optional): pin a version; latest when omitted  
  - `force` (optional): overwrite an existing install  

Example response:

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/example/.squid/skills/demo-skill"
}
```

## Configuration

Resolution order (highest priority first):

1. Environment variables:  
   - `TENCENT_SKILLHUB_BASE_URL`  
   - `TENCENT_SKILLHUB_TOKEN`  
2. `~/.squid/config.json`:  
   - `model.skillhub.tencent.baseUrl`  
   - `model.skillhub.tencent.token`  
   - or legacy `model.tencentSkillHub.baseUrl` / `token`  
3. Default base URL: `https://skillhub.tencent.com/api/v1`  

## Local metadata

Install provenance and lockfiles are written to:

- `~/.squid/skillhub/tencent/lock.json`  
- `~/.squid/skillhub/tencent/origins/<slug>.json`  

## Troubleshooting

- **Empty catalog**: verify `baseUrl` reachability and loosen search keywords.  
- **Install failed (invalid package)**: ensure the archive contains `SKILL.md`.  
- **Repeated install errors**: pass `force: true` or delete the local skill directory first.  
