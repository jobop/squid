# Intégration Tencent SkillHub

## Aperçu des fonctionnalités

La version actuelle ajoute une intégration de base avec Tencent SkillHub :

- Affichage du catalogue de skills (recherche par mot-clé)
- État d’installation (non installé / installé / mise à jour disponible)
- Installation en un clic dans le répertoire local des skills

## API backend

### 1) Lister les skills Tencent SkillHub

- `GET /api/skillhub/tencent/skills`
- Paramètres de requête :
  - `query` (optionnel) : mot-clé de recherche
  - `limit` (optionnel) : nombre de résultats, défaut `20`

Exemple de réponse :

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

### 2) Installer un skill SkillHub en un clic

- `POST /api/skillhub/tencent/install`
- Corps JSON :
  - `slug` (obligatoire) : identifiant du skill
  - `version` (optionnel) : version cible ; défaut = dernière
  - `force` (optionnel) : réinstallation par-dessus

Exemple de réponse :

```json
{
  "success": true,
  "slug": "demo-skill",
  "version": "1.0.0",
  "targetDir": "/Users/xxx/.squid/skills/demo-skill"
}
```

## Configuration

Sources prises en charge (priorité décroissante) :

1. Variables d’environnement :  
   - `TENCENT_SKILLHUB_BASE_URL`  
   - `TENCENT_SKILLHUB_TOKEN`  
2. Dans `~/.squid/config.json` :  
   - `model.skillhub.tencent.baseUrl`  
   - `model.skillhub.tencent.token`  
   - ou `model.tencentSkillHub.baseUrl` / `token`  
3. Adresse par défaut : `https://skillhub.tencent.com/api/v1`

## Métadonnées locales

L’origine d’installation et les fichiers de verrouillage sont écrits dans :

- `~/.squid/skillhub/tencent/lock.json`
- `~/.squid/skillhub/tencent/origins/<slug>.json`

## Dépannage

- **Liste vide** : vérifier l’accessibilité de `baseUrl` et l’étroitesse éventuelle du filtre de recherche.  
- **Échec d’installation (structure de paquet invalide)** : le paquet renvoyé doit contenir `SKILL.md`.  
- **Échec sur réinstallation** : utiliser `force: true` ou supprimer le répertoire local du skill portant le même nom.  
