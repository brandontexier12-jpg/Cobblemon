# Architecture

```
darts-evolution/
├── apps/
│   ├── server/            Node.js + TypeScript : Fastify (REST), Socket.IO, SQLite (node:sqlite)
│   │   ├── src/db/        connexion, transactions, migrations (sauvegarde avant migration)
│   │   ├── src/services/  joueurs, parties, statistiques, compétitions, entraînements,
│   │   │                  sauvegardes, exports, réglages, authentification, pont Autodarts
│   │   ├── src/http/      routes REST, temps réel (salles), messages de validation en français
│   │   └── test/          tests d'intégration (API, persistance, sauvegardes, Autodarts, Socket.IO)
│   └── web/               React + Vite + Tailwind CSS (interface en français)
├── packages/
│   ├── shared/            modèle de fléchette, contrat ScoringProvider, événements de détection
│   ├── game-engine/       moteur de jeu pur : modes, règles, checkout, vues (aucune E/S)
│   ├── statistics/        formules statistiques, séries, records, badges, objectifs
│   └── autodarts-adapter/ client de l'API locale Autodarts, suivi d'instantanés, simulateur, capture
├── docker/                lanceur du conteneur, contrôle de santé, compose « image seule »
├── docs/                  documentation (français)
├── Dockerfile, docker-compose.yml, .env.example, .dockerignore
└── data/, backups/        (exécution : jamais versionnés)
```

## Principes

- **Le serveur est l'unique autorité du score.** L'interface n'envoie que des intentions (« fléchette
  T20 », « joueur suivant », « annuler », « corriger ») ; le moteur calcule tout, y compris les
  propositions de checkout.
- **Journal d'événements.** Une partie = configuration + liste ordonnée d'événements (`dart`, `next`).
  L'état est obtenu en rejouant le journal : annuler = marquer le dernier événement « annulé » ;
  corriger = remplacer un événement et rejouer. Les visites et résultats (`match_visits`,
  `match_results`) sont **dérivés** et réécrits après chaque commande, d'où des statistiques toujours
  cohérentes, même après correction d'une partie terminée.
- **Tirages au sort figés** à la création (numéros du Killer, ordre aléatoire, scores de checkout) :
  rejouer une partie donne toujours le même résultat.
- **Commandes idempotentes** : chaque commande porte un identifiant unique (rejouée = ignorée) et la
  version de la partie vue par l'appareil (périmée = refusée avec actualisation). Les commandes sont
  synchrones dans une transaction SQLite : aucune exécution entrelacée.
- **Fournisseurs de scoring interchangeables** : `ManualScoringProvider` et `AutodartsScoringProvider`
  implémentent la même interface et produisent le même `DetectedThrow` ; le moteur ignore d'où vient une
  fléchette (seule sa provenance est mémorisée pour l'affichage et le journal).
- **Aucune dépendance native** : `node:sqlite` intégré à Node 22, serveur assemblé en un fichier
  (esbuild) ; même image pour x86-64 et ARM64.

## Données (SQLite)

| Table | Contenu |
|---|---|
| `players` | profils (pseudo, avatar, couleur, niveau, invité, archivage) |
| `matches`, `match_players` | parties : mode, options, configuration préparée, statut, saisie, code de salle, simulation |
| `match_events` | journal (fléchettes, fins de visite), provenance, identifiant Autodarts (unique), statut, position de l'impact `x`/`y` (migration 2) |
| `match_commands` | identifiants de commandes déjà appliquées (idempotence) |
| `match_visits`, `match_results` | données dérivées pour statistiques et historique |
| `exercises`, `weekly_goals` | exercices personnalisés, objectifs hebdomadaires |
| `competitions`, `competition_players`, `competition_fixtures` | tournois et championnats |
| `settings` | réglages (Autodarts, sauvegardes, préférences, partie liée à Autodarts) |
| `autodarts_events` | journal technique Autodarts (borné aux 5 000 derniers événements) |
| `schema_migrations` | version du schéma |

Les statistiques historiques ne sont jamais supprimées automatiquement ; seuls le journal technique
Autodarts et les sauvegardes **automatiques** au-delà de la rétention sont élagués.

## Sécurité

- Validation de toutes les entrées (zod) côté serveur, messages d'erreur en français sans détail interne.
- Administration par mot de passe (`ADMIN_PASSWORD`, conservé uniquement sous forme dérivée scrypt) :
  session en cookie `httpOnly` + `SameSite=Strict`, 5 essais par minute. Protégés : sauvegardes
  (liste, téléchargement, restauration, suppression), export complet, configuration et test Autodarts,
  mode test, suppression de parties et de compétitions, suppression définitive de joueurs.
- En-têtes : Content-Security-Policy stricte (aucun script externe), `X-Content-Type-Options`,
  `X-Frame-Options`, `Referrer-Policy` ; API en `Cache-Control: no-store`.
- Journaux sans cookie ni en-tête d'autorisation ; aucune réponse brute d'Autodarts n'est journalisée.
- Exports CSV protégés contre l'injection de formules ; noms de sauvegardes validés (pas de traversée
  de dossier).
- Conteneur : processus non root (PUID/PGID), `no-new-privileges`, pas de mode privilégié, pas de
  socket Docker, ni d'accès USB. Ne pas exposer l'application ni Autodarts sur Internet : usage réseau
  local (pour un accès distant, passer par un VPN).
