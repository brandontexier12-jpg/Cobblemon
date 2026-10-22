# DARTS EVOLUTION

Application complète de fléchettes, auto-hébergée sur un NAS TerraMaster (Docker) et utilisable sur le
réseau local depuis un ordinateur, une tablette ou un téléphone : scoring X01 et Cricket, autres jeux,
entraînements, statistiques, compétitions, multijoueur local, sauvegardes, et **détection automatique des
impacts via Autodarts**.

- Accès : **http://IP_DU_NAS:8080** (port configurable)
- Interface entièrement en français, thème sombre « noir / anthracite / orange électrique »
- Données en SQLite dans `./data`, sauvegardes dans `./backups`

> **Autodarts : à lire.** L'intégration utilise l'**API locale non officielle** du Board Manager
> Autodarts (port 3180, WebSocket `/api/events`), observée sur les versions 1.x et 2.0.x (2.0.2).
> Elle a été testée contre un simulateur fidèle au protocole publié, **pas contre un matériel réel**
> (indisponible pendant le développement). Le test matériel reste à faire : procédure dans
> [`docs/autodarts.md`](docs/autodarts.md). La saisie manuelle fonctionne toujours, Autodarts ou non.

## Sommaire

- [Démarrage rapide](#démarrage-rapide)
- [Fonctionnalités](#fonctionnalités)
- [Installation sur TerraMaster](#installation-sur-terramaster)
- [Variables d'environnement](#variables-denvironnement)
- [Connexion Autodarts](#connexion-autodarts)
- [Sauvegardes et mises à jour](#sauvegardes-et-mises-à-jour)
- [Diagnostic](#diagnostic)
- [Développement et tests](#développement-et-tests)
- [Limites connues](#limites-connues)
- Documentation détaillée : [installation TerraMaster](docs/installation-terramaster.md) ·
  [Autodarts](docs/autodarts.md) · [modes de jeu](docs/modes-de-jeu.md) ·
  [statistiques](docs/statistiques.md) · [architecture et sécurité](docs/architecture.md) ·
  [dépannage](docs/depannage.md)

## Démarrage rapide

```bash
cp .env.example .env          # puis définir au moins ADMIN_PASSWORD
docker compose up -d --build  # construit l'image (tests compris) et démarre
docker compose logs -f        # « DARTS EVOLUTION … prêt sur … »
```

Ouvrir `http://IP_DU_NAS:8080`, créer les joueurs (**Joueurs**), puis **Jouer**.

## Fonctionnalités

**Jeu et scoring** (moteur pur, testé, piloté par journal d'événements)
- **X01** 301 / 501 / 701 / 901 / 1001 ; départ simple, double, master ; sortie simple, double, master
  (dont 301/501 **sans obligation de double**) ; bust ; legs et sets ; alternance du joueur qui commence.
- **Cricket** classique et cut-throat (15–20 + bull, marques, points, limite de manches).
- **Count-up, High Score, Around the Clock** (zones, saut), **Around the World, Bob's 27, Killer, Shanghai**.
- **Entraînements** doubles, triples, bull, checkout, **exercices personnalisés** (enregistrables).
- **Assistant de checkout** calculé par algorithme (170 = T20 T20 Bull, 100 = T20 D20, 40 = D20…),
  alternatives, scores impossibles, stratégie (classique, bull, double favori), fléchettes restantes.
- Annuler une fléchette, terminer une visite, **corriger n'importe quelle fléchette**, même d'une partie
  terminée : la partie est rejouée, statistiques et compétitions mises à jour.
- **Parties interrompues** reprises après un redémarrage (liste « Parties en cours » sur l'accueil).

**Écran de jeu** inspiré des écrans de scoring en direct
- **Cible au centre** : chaque impact de la visite apparaît à sa position réelle (coordonnées Autodarts) ou au
  centre de sa case (saisie manuelle), case touchée éclairée, cible à viser mise en évidence (entraînements).
- **Barre de visite** : les 3 fléchettes, le total, la consigne (« retirez les fléchettes pour passer à… »)
  et la sortie conseillée ; **panneaux des joueurs** de part et d'autre avec le score restant en très grand,
  moyennes (partie et leg) et compteurs.
- Saisie manuelle **en touchant la cible** ou au **pavé** (au choix, mémorisé par appareil).
- **Sons** générés par l'appareil, sans fichier ni Internet : un son par impact (simple, double, triple,
  25, bull, raté), bust, sortie, victoire, carillon au changement de joueur ; **annonceur vocal** en français
  (score de la visite, « Cent quatre-vingts ! », « Bust ! », « Bob, il vous reste 40 », « À Bob de jouer »),
  réglable : muet, scores et joueurs, ou chaque fléchette. Le son s'active au premier toucher de l'écran
  (règle des navigateurs).

**Autodarts** : connexion locale, impacts transmis au moteur en temps réel, retrait = fin de visite (jamais
un impact), déduplication, reconnexion automatique sans double comptage, alerte en cas de coupure, bascule
en saisie manuelle, test de connexion avec diagnostic, journal des événements, **mode test simulé** (exclu
des statistiques), outil de capture du flux réel.

**Statistiques** : moyenne 3 fléchettes, par fléchette, par visite, 1re visite, 9 premières, meilleure
visite, 180 / 140+ / 100+, réussite aux doubles, au bull, taux et meilleur checkout, victoires, séries,
fléchettes par leg ; graphiques journaliers / hebdomadaires / mensuels, précision, comparaison de périodes,
calendrier d'entraînement ; filtres joueur, période, mode, adversaire. Formules : [`docs/statistiques.md`](docs/statistiques.md).

**Progression** : records personnels, niveaux (XP), badges, objectifs hebdomadaires — calculés uniquement
à partir des données réelles.

**Joueurs** : profils (pseudo, avatar, couleur, niveau, double favori), invités, profil actif, classement,
comparaison face-à-face, suppression avec confirmation (historique conservé).

**Multijoueur local** : chaque partie a un **code de salle** ; d'autres appareils la rejoignent comme
joueur ou **spectateur** ; scores synchronisés en temps réel ; le serveur reste l'autorité ; messages
répétés et validations simultanées protégés.

**Compétitions** : élimination directe (têtes de série, exemptions), championnat toutes rondes (aller /
retour, points), matchs lancés depuis le tableau, résultats saisis à la main, classement, export CSV.

**Données** : SQLite avec migrations et transactions, sauvegardes automatiques et manuelles, sauvegarde
avant migration, restauration (avec sauvegarde de sécurité), export JSON complet et CSV.

**Sécurité** : validation serveur, mot de passe administrateur, en-têtes de sécurité, processus non root.
Détails : [`docs/architecture.md`](docs/architecture.md).

## Installation sur TerraMaster

Procédure détaillée, écran par écran : **[`docs/installation-terramaster.md`](docs/installation-terramaster.md)**.

1. Installer / ouvrir **Docker Manager** (Container Manager sous TOS 7).
2. Créer `/Volume1/docker/darts-evolution/` avec les sous-dossiers `data` et `backups`.
3. Y copier le dossier `darts-evolution` (ou importer une image construite sur un PC).
4. Copier `.env.example` en `.env`, définir `ADMIN_PASSWORD` (et `APP_PORT`, `PUID`/`PGID` si besoin).
5. Docker Manager → **Projets → Ajouter** → chemin du dossier, fichier `docker-compose.yml` → Valider → Appliquer.
6. Vérifier les journaux (« prêt sur … ») et l'état **healthy**.
7. Ouvrir `http://IP_DU_NAS:8080`.
8. **Intégration Autodarts** : IP de la machine Autodarts, port 3180, Tester, Activer.
9. Tester une détection réelle ([procédure](docs/autodarts.md#8-test-sur-le-matériel-réel-à-effectuer)).
10. **Paramètres → Sauvegardes** : fréquence, rétention ; inclure `backups/` dans les sauvegardes du NAS.

Configuration de référence (**A**) : DARTS EVOLUTION sur le NAS, Autodarts sur une autre machine du réseau
(les 3 caméras USB ne sont pas supposées utilisables depuis le NAS). Configuration **B** (tout sur la même
machine) seulement après vérification de la compatibilité matérielle : voir [`docs/autodarts.md`](docs/autodarts.md#5-configurations-matérielles).

### Fichiers Docker

| Fichier | Rôle |
|---|---|
| [`Dockerfile`](Dockerfile) | Image multi-étapes : `npm ci` (lockfile), **tests**, build ; image finale `node:22.22.0-alpine3.23` avec le serveur assemblé et l'interface |
| [`docker-compose.yml`](docker-compose.yml) | Service unique : port `${APP_PORT}:8080`, volumes `./data` et `./backups`, `restart: unless-stopped`, `init`, limite mémoire 512 Mo / 1 CPU, `no-new-privileges`, rotation des journaux |
| [`docker/docker-compose.image-only.yml`](docker/docker-compose.image-only.yml) | Même chose sans construction (image importée) |
| [`docker/launcher.mjs`](docker/launcher.mjs) | Prépare `data`/`backups`, applique PUID/PGID, abandonne root, démarre le serveur |
| [`docker/healthcheck.mjs`](docker/healthcheck.mjs) | Contrôle de santé (`/api/health` : API + base) |
| [`.env.example`](.env.example) | Toutes les variables, commentées |

Pas de mode privilégié, pas de socket Docker, pas d'accès USB.

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `APP_PORT` | `8080` | Port publié sur le NAS (le conteneur écoute sur 8080) |
| `TZ` | `Europe/Paris` | Fuseau horaire (statistiques par jour/semaine/mois, noms de sauvegardes) |
| `PUID` / `PGID` | `1000` / `1000` | Propriétaire des fichiers de `data` et `backups` |
| `ADMIN_PASSWORD` | vide | Mot de passe administrateur (fortement recommandé) |
| `BACKUP_INTERVAL_HOURS` | `24` | Sauvegarde automatique (0 = désactivée) |
| `BACKUP_RETENTION` | `14` | Sauvegardes automatiques conservées |
| `AUTODARTS_ENABLED` | `false` | Connexion Autodarts au démarrage |
| `AUTODARTS_HOST` | vide | IP / nom de la machine Autodarts |
| `AUTODARTS_PORT` | `3180` | Port de l'API locale du Board Manager |
| `AUTODARTS_PROTOCOL` | `http` | `http` ou `https` |
| `LOG_LEVEL` | `info` | `error`, `warn`, `info`, `debug` |
| `RUN_TESTS` | `true` | Exécuter les tests pendant la construction de l'image |
| `DATABASE_PATH` | `/app/data/darts-evolution.db` | Chemin de la base (interne au conteneur) |
| `BACKUP_PATH` | `/app/backups` | Dossier des sauvegardes (interne au conteneur) |

Les réglages Autodarts et sauvegardes modifiés dans l'interface sont enregistrés en base et remplacent
ensuite les valeurs d'environnement. Aucune clé d'API Autodarts n'est demandée : l'API locale n'en
utilise pas.

## Connexion Autodarts

1. Sur la machine Autodarts, vérifier que le Board Manager tourne et détecte les fléchettes.
2. DARTS EVOLUTION → Paramètres → connexion administrateur.
3. **Intégration Autodarts** → IP de la machine (ex. `192.168.1.50`), port `3180` → **Tester la connexion**
   (version, détection, détail des lancers, WebSocket) → activer → **Enregistrer**.
4. **Jouer** → saisie **Autodarts** : la partie est liée à la détection. Une visite se termine au retrait
   des fléchettes ; « Passer en saisie manuelle » est toujours disponible.

Sans matériel : **Démarrer le mode test** (page Intégration) ou `npm run simulator`.

## Sauvegardes et mises à jour

- **Automatiques** : toutes les `BACKUP_INTERVAL_HOURS` heures (copie cohérente `VACUUM INTO`) ; seules
  les sauvegardes automatiques au-delà de `BACKUP_RETENTION` sont supprimées.
- **Manuelles** : Paramètres → Sauvegardes → Sauvegarder maintenant ; téléchargement du fichier `.db`.
- **Avant migration** : créée automatiquement au démarrage d'une nouvelle version qui modifie le schéma.
- **Restauration** : depuis la liste ou un fichier envoyé ; sauvegarde de sécurité préalable ; contrôle
  d'intégrité ; refus d'une sauvegarde d'une version plus récente.
- **Exports** : JSON complet (administrateur), CSV joueurs / parties / visites / résultats.

**Mise à jour** : sauvegarder → remplacer les fichiers du projet (sans toucher `data/`, `backups/`,
`.env`) → `docker compose up -d --build` (ou « Reconstruire » dans Docker Manager). Vérifié : une partie
en cours et les joueurs survivent au redémarrage et au remplacement de l'image.

## Diagnostic

```bash
docker ps --filter name=darts-evolution          # Up … (healthy)
docker compose logs --tail 200 -f                 # journaux
curl -s http://localhost:8080/api/health          # {"status":"ok","database":"ok",…}
docker stats darts-evolution --no-stream          # mémoire / CPU
```

Tableau des problèmes fréquents : [`docs/depannage.md`](docs/depannage.md).

## Développement et tests

Prérequis : Node.js ≥ 22.13 (module `node:sqlite`).

```bash
npm install
npm run dev:server     # API + Socket.IO sur :8080 (rechargement automatique)
npm run dev:web        # interface sur :5173 (proxy vers :8080)
npm test               # 121 tests (moteur, statistiques, adaptateur Autodarts, serveur, interface)
npm run typecheck      # vérification TypeScript de tous les paquets
npm run build          # interface (Vite) + serveur assemblé (esbuild)
npm start              # sert l'interface construite et l'API
npm run simulator      # simulateur de Board Manager (SIMULATION)
```

Vérification de l'interface dans un navigateur (facultatif, nécessite Playwright, serveur démarré sur une
base vide) : `BASE=http://localhost:8080 TOUR=1 node tests/e2e/ui-smoke.cjs`.

Résultats vérifiés lors de la livraison :
- `npm test` : **11 fichiers, 121 tests réussis** (dont un flux Autodarts de bout en bout contre le
  simulateur, la reconnexion, les doublons, la persistance après redémarrage, les sauvegardes, la
  sécurité et le multijoueur Socket.IO) ;
- `npm run typecheck` : sans erreur ;
- construction Docker : tests exécutés dans l'image, image d'environ 59 Mo compressée ;
- conteneur : état *healthy*, droits PUID/PGID appliqués, fuseau horaire correct, données conservées
  après redémarrage et remplacement d'image, conteneur joignant un Board Manager (simulé) sur une autre
  adresse réseau ;
- interface : parcours complet automatisé dans Chromium (création de joueurs, partie 301 saisie en touchant
  la cible puis au pavé, checkout, victoire avec annonces vocales, statistiques, mode test Autodarts en
  direct) et visite de toutes les pages sur ordinateur et téléphone, sans erreur ni défilement horizontal ;
- matériel réel : détection Autodarts vérifiée par l'utilisateur (impacts « AD » T20, S7, S10, S5, total de
  visite correct, attente du retrait avant le joueur suivant).

## Limites connues

- **Autodarts** : API locale non officielle ; testée contre un simulateur et des jeux d'essai reconstitués
  à partir des formes publiées (provenance dans `packages/autodarts-adapter/test/fixtures/README.md`), et
  vérifiée par l'utilisateur sur sa cible réelle (impacts et retrait). Le repère des coordonnées d'impact
  (centre 0, anneau double ≈ 1, y vers le 20) n'a pas été mesuré sur matériel réel : si une position reçue
  ne tombe pas dans la case comptée, la cible affiche la fléchette au centre de sa case. La forme du bull intérieur n'a pas été observée en 2.0.2 (forme 1.x/2.0.0
  utilisée). Certaines installations 2.x ne transmettent pas les lancers en local : détecté et signalé,
  saisie manuelle alors nécessaire. L'API cloud n'est pas utilisée.
- **Multijoueur** : réseau local uniquement (pas d'accès Internet ; utiliser un VPN pour un accès distant).
- **Compétitions** : matchs au format X01 ; pas de phase de poules suivie d'un tableau.
- **Interface** : français uniquement ; thème sombre uniquement (choix d'identité).
- La procédure Docker Manager a été rédigée d'après la documentation TerraMaster (TOS 6/7) ; les
  libellés exacts peuvent varier selon la version de TOS. Le conteneur lui-même a été vérifié avec
  Docker Engine 29 / Compose v5.
