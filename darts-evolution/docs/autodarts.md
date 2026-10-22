# Intégration Autodarts

Ce document décrit ce qui a été vérifié sur l'API d'Autodarts, comment DARTS EVOLUTION l'utilise,
ses limites, et la procédure de test sur le matériel réel.

> **Statut honnête.** L'intégration a été développée et testée contre un **simulateur** qui reproduit
> le protocole publiquement observé. **Aucun matériel Autodarts n'était disponible pendant le
> développement : le test avec un Board Manager réel reste à effectuer** (procédure en fin de document).

---

## 1. Vérification préalable (octobre 2026)

| Question | Constat | Source |
|---|---|---|
| Interface visée | API **locale** du **Board Manager** Autodarts (le logiciel qui pilote les 3 caméras), port **3180** par défaut | n4-darts, ha-autodarts, ioBroker.autodarts |
| Statut officiel | **Non documentée officiellement** par Autodarts. Aucune spécification publique. | n4-darts (`docs/board-manager-api.md`), ha-autodarts |
| Versions observées | Board Manager **1.x** (classique, ex. 1.0.7) et **2.0.x** (« Board Manager 2 », headless), **observée en 2.0.2 le 2026-10-18** | n4-darts ; ha-autodarts (testé jusqu'à 2.0.2) |
| Accès aux événements | WebSocket `ws://<hôte>:3180/api/events` + lecture `GET /api/state` | n4-darts, ha-autodarts |
| Authentification | **Aucune** en local (clé d'API vide dans la configuration observée) | n4-darts ; ha-autodarts (« port 3180, no login ») |
| Internet / compte | **Non requis** pour l'API locale (fonctionne machine hors ligne) | n4-darts |
| Divergence signalée | L'adaptateur ioBroker indique que sur certaines installations **v2.0+**, le port 3180 répond mais **sans données de lancer** (`throws` vide). n4-darts et ha-autodarts reçoivent pourtant les lancers en 2.0.2 via le WebSocket. | ioBroker.autodarts (`docs/en/faq.md`) |
| API cloud | `api.autodarts.io` / `.com` (WebSocket `/ms/v0/subscribe`, authentification par compte) : **non officielle, non publiée**, exige les identifiants du compte | autodarts_local_tournament (`docs/autodarts-api-capabilities.md`), ioBroker cloud |
| Port 3180 « ancien » | Le prompt demandait de ne pas supposer que 3180 fonctionne encore : il est **toujours utilisé en 2.0.2** selon deux projets indépendants, mais rien ne garantit les versions futures | — |

Sources consultées :
- n4-darts — https://github.com/sverbach/n4-darts (`docs/board-manager-api.md`, ADR 0001 et 0003)
- ha-autodarts — https://github.com/JoeyAwwad/ha-autodarts (`custom_components/autodarts/local_api.py`, `docs/how-it-works.md`, `docs/security.md`)
- ioBroker.autodarts — https://github.com/inventwo/ioBroker.autodarts (`docs/en/faq.md`, `lib/cloud.js`)
- autodarts_local_tournament — https://github.com/thomasasen/autodarts_local_tournament (`docs/autodarts-api-capabilities.md`)
- Documentation Autodarts — https://docs.autodarts.io (installation Linux, FAQ matériel)

**Choix retenu** : l'API locale (WebSocket + HTTP), sans compte ni Internet. L'API cloud n'est **pas**
utilisée : non documentée, elle demanderait vos identifiants Autodarts et un identifiant client non
délivré publiquement. Toute la dépendance au protocole est isolée dans `packages/autodarts-adapter/`.

## 2. Protocole utilisé

- `GET /api/version` → texte, ex. `2.0.2` (génération 1 ou 2 déduite du numéro majeur).
- `GET /api/state` → instantané complet :

```json
{"connected":true,"running":true,"event":"Throw detected","status":"Throw","numThrows":2,
 "throws":[{"bouncer":false,"coords":{"x":0.0021,"y":0.6012},
            "segment":{"bed":"Triple","multiplier":3,"name":"T20","number":20}}, …]}
```

- `ws://hôte:3180/api/events` → messages `{"type":"state","data":{…même forme…}}`. **Chaque message est
  un instantané complet, pas un delta.** Les autres types (`motion_state`, `cam_state`, `stats`,
  `cam_stats`) sont ignorés.
- `POST /api/reset` (commande « Réinitialiser la cible », envoyée une seule fois, jamais rejouée).

Correspondance des segments :

| Lancer | `bed` | `name` | `number` | `multiplier` | Interne |
|---|---|---|---|---|---|
| Simple | `SingleInner` / `SingleOuter` | `S20` | 1–20 | 1 | S20 |
| Double / triple | `Double` / `Triple` | `D16`, `T19` | 1–20 | 2 / 3 | D16, T19 |
| Bull extérieur | `Single` | `25` | 25 | 1 | 25 points |
| Bull intérieur | `Double` (forme ha-autodarts, non observée en 2.0.2) | `Bull` | 25 | 2 | 50 points (compte comme double) |
| Raté hors cible | `Outside` | `M17` | 17 | 0 | Raté (0) |
| Rebond | `Outside`, `bouncer: true` | `Miss` | 0 | 0 | Raté (0) |

Cycle d'une visite observé : `Throw detected`/`Throw` (1, 2 fléchettes) → `Throw detected`/`Takeout`
(3e fléchette) → `Takeout started`/`Takeout in progress` → `Takeout finished`/`Throw` (`numThrows` 0,
`throws` absent). Un retrait peut avoir lieu après 1 ou 2 fléchettes.

## 3. Traitement dans DARTS EVOLUTION

```
Board Manager ──WebSocket /api/events──► AutodartsScoringProvider ──► BoardTracker (comparaison d'instantanés)
                └─GET /api/state (synchro, reconnexion, réconciliation)        │
                                                                                ▼
                                        ScoringEvent : throw · throw-corrected · takeout-* · reset · gap · status · invalid
                                                                                │
                                        AutodartsService (serveur) ──► MatchService (moteur de jeu, autorité du score)
```

Règles appliquées (et testées) :

1. **Validation** de chaque message (zod) : un message illisible est ignoré et journalisé ; un lancer
   illisible n'empêche pas de lire les suivants (`25 × 3`, numéro 21… sont refusés).
2. **Un impact = une première apparition** d'une fléchette dans `throws` (nouvelle position). Un message
   identique au précédent (répété) ne produit rien.
3. **Correction par la cible** : même position, segment différent → la fléchette déjà comptée est corrigée
   (pas d'ajout).
4. **Le retrait n'est jamais un impact** : `Takeout finished` (ou la disparition des fléchettes) termine la
   visite. S'il manque des fléchettes (retrait après 1 ou 2), elles sont **comptées ratées** et restent
   corrigeables. Un retrait sans aucune fléchette dans la visite est ignoré.
5. **Fléchettes en trop** : après une visite terminée (3 fléchettes, bust, checkout), une fléchette reçue
   avant le retrait est **ignorée** (jamais attribuée au joueur suivant) et signalée.
6. **Reset manuel** (`Manual reset` sur le Board Manager) = fin de visite ; un reset demandé par
   l'application est reconnu et ignoré.
7. **Déduplication à trois niveaux** : comparaison d'instantanés ; identifiant unique d'impact
   (`session-visite-position`) stocké avec l'événement de partie (index unique en base) ; identifiant de
   commande idempotent (`ad:<impact>`).
8. **Connexion à froid** : les fléchettes déjà présentes sur la cible au démarrage ne sont pas comptées
   (elles ont pu l'être avant un redémarrage du serveur).
9. **Reconnexion** : backoff 1 s → 30 s (aléa ±20 %), ping WebSocket toutes les 15 s (coupure détectée en
   moins de 25 s). À la reconnexion, `GET /api/state` est comparé au dernier état connu : seules les
   fléchettes nouvelles sont ajoutées ; si la cible a été vidée pendant la coupure, une **alerte « gap »**
   est affichée (une visite a pu être jouée sans être reçue) — **aucun impact n'est inventé**.
10. **Réconciliation** toutes les 20 s par HTTP : n'ajoute que des fléchettes manquantes, ne vide jamais la
    cible (une réponse HTTP peut être plus ancienne qu'un message WebSocket).
11. **Absence de données de lancer** (comportement v2 signalé) : détectée (`numThrows > 0` sans `throws`),
    affichée comme diagnostic ; rien n'est compté.
12. **Simulation** : les impacts du mode test portent `simulated: true` / source `simulation` ; ils ne sont
    acceptés que par une partie marquée « simulation », elle-même exclue de toutes les statistiques.
    Un impact réel est refusé par une partie de test et inversement.
13. **Position de l'impact** : les coordonnées `coords` de chaque lancer sont enregistrées avec la fléchette
    (colonnes `x`, `y`) et affichées sur la cible de l'écran de jeu. Elles ne servent jamais au calcul du
    score. Repère supposé : centre (0, 0), bord extérieur du double = 1, y vers le 20 (valeurs des jeux
    d'essai : T20 ≈ (0, 0,60), D20 ≈ (0, 0,97)). Si une position ne tombe pas dans la case comptée (repère
    différent, fléchette corrigée), la fléchette est dessinée au centre de sa case ; un repère à axe
    vertical inversé est reconnu automatiquement.

Le score reste calculé **uniquement par le serveur** ; la saisie manuelle reste disponible à tout moment
(bouton « Passer en saisie manuelle » ; saisie d'une fléchette manquée par la détection).

### Calibration des caméras depuis l'application

Bouton **« Recalibrer »** (écran de jeu en saisie Autodarts) et carte **« Calibration des caméras »** (page
Intégration Autodarts). L'application envoie à Autodarts :

- `POST /api/config/calibration/auto` : calibration automatique de toutes les caméras ;
- `POST /api/config/calibration/auto/<caméra>?distortion=true` : une caméra, avec correction de la distorsion
  (caméras numérotées à partir de 0 ; leur nombre est lu dans `GET /api/config`, champ `cam.cams`).

Ces routes ne sont pas documentées officiellement : ce sont celles qu'emploient deux intégrations
indépendantes, l'adaptateur ioBroker d'Autodarts (`lib/systemInfo.js`) et l'intégration Home Assistant
« ha-autodarts » (`local_api.py`, avec ses tests). La réponse arrive à la fin de la calibration (délai accordé :
60 s). Pendant la calibration et 5 s après, les impacts et retraits signalés sont ignorés et journalisés
(la partie n'est jamais faussée) ; une seconde demande simultanée est refusée. Un refus d'Autodarts (HTTP 409)
ou une version sans ces routes (HTTP 404) est expliqué à l'utilisateur. Vérifié contre le simulateur ;
**à confirmer sur votre matériel** (retirer les fléchettes avant de lancer).

## 4. Configuration

Variables d'environnement (valeurs initiales, modifiables ensuite dans « Intégration Autodarts ») :

| Variable | Défaut | Rôle |
|---|---|---|
| `AUTODARTS_ENABLED` | `false` | Active la connexion au démarrage |
| `AUTODARTS_HOST` | vide | IP ou nom de la machine qui exécute le Board Manager |
| `AUTODARTS_PORT` | `3180` | Port de l'API locale |
| `AUTODARTS_PROTOCOL` | `http` | `http` ou `https` |

Il n'y a **pas** de variable de clé d'API : l'API locale observée n'en utilise pas. Ne saisissez jamais
vos identifiants de compte Autodarts dans DARTS EVOLUTION.

## 5. Configurations matérielles

**Configuration A (référence)** — DARTS EVOLUTION sur le NAS TerraMaster, Autodarts sur un PC / mini-PC /
Raspberry Pi 5 relié aux 3 caméras. Indiquez l'**IP de cette machine** (pas `localhost`) dans la page
Intégration. Le NAS et la machine Autodarts doivent être sur le même réseau local et le port 3180 joignable
(pare-feu). Vérifié dans Docker : le conteneur joint un Board Manager (simulé) par l'adresse réseau d'une
autre machine, reçoit les impacts et termine la visite au retrait.

**Configuration B** — tout sur le NAS : **non recommandée sans vérification**. Autodarts est surtout
développé pour Linux x86-64/ARM64 avec 3 caméras USB (bande passante USB, pilotes UVC, accélération) ;
la documentation Autodarts conseille un Raspberry Pi 5 refroidi ou un PC. Un NAS TerraMaster n'expose pas
forcément ses ports USB vidéo à Docker et son processeur est rarement dimensionné pour la vision. Si vous
la tentez, faites tourner Autodarts selon sa propre documentation, puis indiquez l'IP du NAS (ou
`172.17.0.1` / l'IP de l'hôte) dans DARTS EVOLUTION. Le conteneur DARTS EVOLUTION n'a besoin d'aucun
accès USB, d'aucun mode privilégié ni du socket Docker.

## 6. Diagnostic de connexion

Le bouton **Tester la connexion** vérifie : adresse, `/api/version`, `/api/state`, détection démarrée,
présence du détail des lancers, ouverture du WebSocket. Messages possibles :

| Code | Signification | Que faire |
|---|---|---|
| `invalid_address` | Adresse mal saisie | IP ou nom d'hôte seul, sans `http://` |
| `dns` | Nom introuvable | Utiliser l'IP |
| `refused` | Port fermé | Board Manager arrêté ? bon port ? |
| `timeout` / `unreachable` | Machine injoignable | Allumée ? même réseau ? pare-feu ? |
| `not_board_manager` | Autre service sur ce port | Vérifier le port |
| `auth_required` | 401/403 | Version différente de celles observées : voir § 1 |
| `incompatible` | Format inattendu | Version non vérifiée : saisie manuelle, capture (§ 8) |
| `detection_stopped` | Détection arrêtée | Démarrer la détection dans Autodarts |
| `no_throw_data` | Lancers non transmis | Limite de cette installation v2 : saisie manuelle |

Le **journal** (page Intégration) liste chaque événement et son traitement : appliqué, doublon ignoré,
ignoré (raison), refusé (raison).

## 7. Mode test

« Démarrer le mode test » remplace temporairement le Board Manager par le simulateur intégré (même
protocole, version 2.0.2) : impacts, rebond, retrait, correction, reset, message dupliqué, message invalide,
coupure, arrêt de la détection. Les parties Autodarts créées pendant ce mode sont marquées **SIMULATION**
et exclues des statistiques et de l'historique par défaut.

Simulateur autonome (pour essayer sans le NAS) :

```bash
npm run simulator -- --host 0.0.0.0 --port 3180     # page de contrôle : http://IP:3180/
```

## 8. Test sur le matériel réel

Premier essai réalisé par l'utilisateur (octobre 2026) : impacts T20, S7, S10 puis S5 reçus avec le badge
« AD », totaux de visite corrects, attente du retrait avant le joueur suivant. Les étapes ci-dessous
restent la procédure complète (version du Board Manager à relever lors du test de connexion).

1. Vérifier que le Board Manager tourne et que la détection fonctionne dans l'interface Autodarts.
2. Dans DARTS EVOLUTION → Intégration Autodarts : saisir l'IP, port 3180, **Tester la connexion**.
   Attendu : version 1.x ou 2.0.x, WebSocket ouvert, détection démarrée.
3. Lancer une fléchette : le test doit indiquer « Détail des lancers : disponible ». Si « absent » :
   limite § 1, utiliser la saisie manuelle.
4. Enregistrer → l'état passe à « Connecté ».
5. Lancer une partie X01 en saisie **Autodarts** ; lancer un simple, un double, un triple, le bull, un raté
   hors cible : chaque impact apparaît avec le badge « AD » et la bonne valeur.
6. Retirer les fléchettes : le joueur suivant est sélectionné, aucun impact n'est ajouté.
   Sur la cible de l'écran de jeu, chaque impact doit apparaître à l'endroit réel où la fléchette s'est
   plantée (repère numéroté 1, 2, 3 au trait plein ; un repère en pointillés signale une position
   représentative, coordonnées absentes ou incohérentes).
7. Retirer après 2 fléchettes : la 3e est comptée ratée.
8. Débrancher le câble réseau de la machine Autodarts 30 s puis le rebrancher : la partie est conservée,
   la reconnexion est automatique, aucune fléchette n'est comptée deux fois.
9. Pour toute différence, enregistrer le flux réel et l'ajouter aux jeux d'essai :

```bash
npm run capture -w @darts-evolution/autodarts-adapter -- --host IP_AUTODARTS --out capture.json
```

La capture affiche en direct les événements déduits par DARTS EVOLUTION et enregistre les messages bruts
(l'état du Board Manager ne contient aucun secret) dans `capture.json`, réutilisable comme jeu d'essai dans
`packages/autodarts-adapter/test/fixtures/`.
