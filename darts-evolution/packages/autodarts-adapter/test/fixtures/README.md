# Flux d'événements de référence

Ces fichiers reproduisent des messages du WebSocket local `/api/events` du Board Manager Autodarts.

**Provenance (important)** : ils n'ont pas été capturés sur un matériel Autodarts pendant le
développement de DARTS EVOLUTION (aucun matériel disponible). Ils sont reconstitués à l'identique
des formes publiquement documentées :

- Board Manager **v2.0.2**, observé le 2026-10-18 par le projet n4-darts
  (`docs/board-manager-api.md`) : `{"type":"state","data":{connected, running, event, status,
  numThrows, throws:[{bouncer, coords:{x,y}, segment:{bed, multiplier, name, number}}]}}`,
  cycle `Throw detected` → `Takeout` (3e fléchette) → `Takeout started` / `Takeout in progress`
  → `Takeout finished` / `Throw`, `throws` absent quand la cible est vide ;
- Board Manager **1.x** et **2.0.0** : jeux d'essai de l'intégration Home Assistant ha-autodarts
  (bull intérieur : `"name":"Bull","number":25,"multiplier":2,"bed":"Double"` — forme non observée
  par n4-darts en 2.0.2).

Un test sur le matériel réel reste à effectuer : voir `docs/autodarts.md`, section « Test matériel ».
Pour enregistrer un vrai flux : `npm run capture -w @darts-evolution/autodarts-adapter -- --host IP`.
