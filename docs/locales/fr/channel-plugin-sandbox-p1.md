# Extensions de canal : orientation bac à sable P1 (ébauche, non implémentée)

Le P0 n’offre que **chemins de confiance + validation du manifest + isolement des échecs par plugin** ; le code d’extension partage l’espace d’adressage du processus principal. Ci-dessous, pistes d’évolution pour revue et planification.

## Objectif

Sans changer la **sémantique** de `ChannelPlugin`, déplacer l’exécution entrante / sortante non fiable ou à haut risque hors du processus principal afin de réduire la surface d’attaque.

## Option A : adaptateur sous-processus

- Le processus principal ne garde qu’un **client RPC léger** ; la logique d’extension tourne dans un **sous-processus** Node/Bun, messages JSON via `stdio` ou socket local.
- `ChannelPlugin.outbound.sendText`, etc. sont sérialisés côté principal en RPC et invoqués dans l’enfant.
- **Avantages** : isolement au niveau OS, possibilité de limiter CPU / mémoire (selon plateforme).  
- **Inconvénients** : latence, complexité de déploiement, synchronisation du cycle de vie avec la fermeture de l’application bureau.

## Option B : fils d’exécution Worker

- Placer calculs purs ou validations sans réseau dans `worker_threads` (si le support Bun est suffisant).
- **Limite** : beaucoup de SDK de messagerie supposent le thread principal ou des modules natifs ; un sous-processus reste souvent nécessaire.

## Option C : Isolate V8 / style `isolated-vm`

- Isolement léger dans un seul processus ; évaluer la **compatibilité Bun** et la disponibilité des API Node.
- Adapté aux **scripts très contraints**, pas à l’hébergement direct de gros SDK officiels.

## Esquisse d’interface (RPC)

```text
Processus principal               Sous-processus extension
  |  spawn(channel-plugin.json)    |
  |----------------init----------->|
  |<-------------ready--------------|
  |  outbound.sendText(payload) --> |
  |<------------- result ----------|
```

L’enveloppe peut contenir `correlationId`, `channelId`, `method`, `payload` ; les erreurs portent `code` + `message` (sans données sensibles).

## Critères d’acceptation suggérés (futurs)

- La chute du sous-processus n’entraîne pas celle du principal ; à l’arrêt du principal, `SIGTERM` puis `SIGKILL` après délai vers l’enfant.  
- Délais d’expiration RPC et quotas configurables (taille des messages, QPS).

Le jalon actuel reste guidé par la documentation et la configuration P0 ; toute réalisation de cette page doit faire l’objet d’un OpenSpec / revue de conception séparée.
