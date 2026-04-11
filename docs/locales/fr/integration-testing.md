# Guide de tests d’intégration

Ce document décrit comment tester la fonctionnalité openclaw-compatible-channels.

## Prérequis

1. Dépendances installées : `npm install`  
2. Clé API configurée (page Réglages)  
3. Application lancée : `npm run dev`  

## Scénarios

### Scénario 1 : notification de fin de tâche planifiée dans le chat

**Objectif :** vérifier qu’à la fin d’une tâche Cron, une notification apparaît dans la zone de chat.

**Étapes :**

1. Démarrer l’application  
   ```bash
   npm run dev
   ```

2. Ouvrir les outils développeur du navigateur, onglet Console.

3. Vérifier la connexion WebSocket  
   ```
   Attendu : [WebSocket] connexion réussie (libellé selon l’implémentation)
   ```

4. Créer une tâche planifiée (outil cron ou API)  
   ```typescript
   const result = cronManager.createTask('*/1 * * * *', 'Afficher l’heure courante'); // toutes les minutes
   console.log(result);
   ```

5. Attendre l’exécution (dans la minute).

6. Vérifier la zone de chat  
   ```
   Attendu :
   - message de notification de fin de tâche
   - identifiant de tâche, statut, durée, etc.
   ```

**Résultat attendu :**

- WebSocket connecté  
- Tâche exécutée  
- Notification visible dans le chat  
- Informations complètes  

---

### Scénario 2 : notification de fin de tâche d’arrière-plan dans le chat

**Objectif :** vérifier les notifications pour les tâches hors Cron.

**Étapes :**

1. Saisir une tâche dans le chat, par ex.  
   ```
   Génère un programme Hello World
   ```

2. Envoyer et attendre la fin.

3. Vérifier la notification de fin dans le chat.

**Résultat attendu :**

- Tâche terminée  
- Notification affichée  
- Résultat inclus  

---

### Scénario 3 : commande du chat vers le moteur

**Objectif :** vérifier que les commandes émises depuis le chat atteignent le moteur.

**Étapes :**

1. Console navigateur.

2. Envoyer une commande de test  
   ```javascript
   window.wsClient.sendCommand('test-command', { param: 'value' });
   ```

3. Vérifier les journaux serveur.

**Résultat attendu :**

- Envoi réussi  
- Commande reçue côté serveur  
- Événement `command` sur EventBridge  

---

### Scénario 4 : reconnexion automatique WebSocket

**Objectif :** après coupure, le client se reconnecte.

**Étapes :**

1. Démarrer l’application et vérifier la connexion.

2. Arrêter le backend (simulation de coupure).

3. Observer la console  
   ```
   Attendu : fermeture de connexion, puis tentative de reconnexion avec délai
   ```

4. Redémarrer le backend.

5. Vérifier la reconnexion.

**Résultat attendu :**

- Détection de la coupure  
- Tentatives de reconnexion  
- Succès après redémarrage  

---

### Scénario 5 : plusieurs clients

**Objectif :** plusieurs onglets connectés simultanément.

**Étapes :**

1. Premier onglet sur l’application.  
2. Second onglet sur la même URL.  
3. Déclencher une fin de tâche depuis l’un des onglets.  
4. Vérifier que les deux reçoivent la notification.

**Résultat attendu :**

- Deux connexions actives  
- Deux notifications  
- Journaux serveur indiquant deux clients  

---

### Scénario 6 : intégration du plugin Feishu OpenClaw (identifiants requis)

**Objectif :** valider l’envoi / la réception via le plugin Feishu.

**Prérequis :** plugin installé, `appId` et `appSecret` configurés.

**Étapes :**

1. Charger le plugin (exemple conceptuel)  
   ```typescript
   import { createOpenClawAdapter } from './channels/openclaw-adapter/adapter';
   import feishuPlugin from '@openclaw/feishu-plugin';
   
   const adapter = createOpenClawAdapter(feishuPlugin, 'feishu');
   channelRegistry.register(adapter);
   await adapter.setup.initialize();
   ```

2. Configurer les identifiants  
   ```typescript
   adapter.config.set('appId', 'your-app-id');
   adapter.config.set('appSecret', 'your-app-secret');
   ```

3. Déclencher une fin de tâche.

4. Vérifier la notification côté Feishu.

5. Envoyer un message depuis Feishu.

6. Vérifier la réception dans l’application.

**Résultat attendu :**

- Plugin initialisé  
- Notification de tâche reçue dans Feishu  
- Message Feishu transmis à l’application  

---

## Tests unitaires

```bash
npm test
```

Couverture typique : envoi / abonnement EventBridge, fonctions de base du WebUIChannelPlugin, configuration, contrôle d’état.

---

## Dépannage

### Échec de connexion WebSocket

**Symptôme :** erreur de connexion dans la console.

**Vérifications :** service backend démarré, port 8080 libre, pare-feu.

**Pistes :**

```bash
lsof -i :8080
# Adapter le port dans config/channels.json si nécessaire
```

### Pas de notification malgré une tâche terminée

**Vérifications :** WebSocket connecté, appels EventBridge, erreurs console.

**Pistes :**

```javascript
console.log(window.wsClient.isConnected()); // true attendu
// Test manuel si exposé dans votre build
```

### Échec de chargement du plugin Feishu

**Vérifications :** installation du paquet, configuration complète, accès réseau aux API Feishu.

**Pistes :**

```bash
npm install @openclaw/feishu-plugin
# adapter.config.validate() si disponible
```

---

## Tests de performance

### Débit de messages

```javascript
for (let i = 0; i < 1000; i++) {
  eventBridge.notifyTaskComplete(`task-${i}`, { result: i });
}
// Vérifier livraison, latence, mémoire
```

### Stabilité longue durée

Lancer l’application 24 h : maintien de la connexion, heartbeats, absence de fuite mémoire évidente.

---

## Liste de contrôle avant publication

- [ ] Tests unitaires EventBridge  
- [ ] Tests unitaires WebUIChannelPlugin  
- [ ] Notification Cron dans le chat  
- [ ] Notification tâche d’arrière-plan dans le chat  
- [ ] Commande chat → moteur  
- [ ] Reconnexion WebSocket  
- [ ] Multi-clients  
- [ ] Intégration Feishu (si utilisée)  
- [ ] Performance  
- [ ] Stabilité longue durée  

---

## Automatisation future

```typescript
describe('E2E', () => {
  it('après une tâche Cron, le chat reçoit une notification', async () => {
    // Démarrer l’app, créer la tâche, attendre, assert WebSocket / UI
  });
});
```
