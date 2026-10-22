# Installation sur un NAS TerraMaster (Docker Manager)

Procédure pas à pas pour une personne non spécialiste. Les libellés de l'interface TOS peuvent varier
selon la version (dans TOS 7, « Docker Manager » s'appelle « Container Manager »).

**Ce qu'il faut savoir avant de commencer**
- DARTS EVOLUTION tourne dans **un seul conteneur**. Il n'a besoin ni du mode privilégié, ni du socket
  Docker, ni des ports USB.
- Les données vivent dans deux dossiers du NAS : `data` (base SQLite) et `backups` (sauvegardes).
  Ils survivent aux redémarrages, mises à jour et suppressions du conteneur.
- Autodarts (les caméras) tourne normalement sur **une autre machine** du réseau (configuration A,
  voir `docs/autodarts.md`).

---

## 1. Installer ou ouvrir Docker Manager

TOS → Centre d'applications → installer **Docker Manager** (ou Container Manager) si nécessaire.
À la première ouverture, installez le moteur Docker si l'application le demande.

## 2. Créer le dossier du projet

Avec l'explorateur de fichiers de TOS, créez par exemple :

```
/Volume1/docker/darts-evolution/
├── data/        (vide)
└── backups/     (vide)
```

## 3. Importer ou copier les fichiers

Deux méthodes, au choix.

**Méthode 1 — construire sur le NAS (le plus simple)** : copiez **tout le dossier `darts-evolution`**
du dépôt (sources comprises) dans `/Volume1/docker/darts-evolution/`. Le fichier `docker-compose.yml`
contient la section `build:` : l'image est construite sur le NAS au premier démarrage (quelques minutes ;
tests automatiques compris). Sur un NAS peu puissant, mettez `RUN_TESTS=false` dans `.env` pour accélérer.

**Méthode 2 — construire sur un ordinateur puis importer l'image** (NAS peu puissant) :

```bash
# Sur un ordinateur avec Docker, dans le dossier darts-evolution :
docker build -t darts-evolution:1.4.0 .
docker save darts-evolution:1.4.0 | gzip > darts-evolution-1.4.0.tar.gz
# NAS ARM64 (ex. processeurs Realtek/ARM) depuis un PC x86 :
docker buildx build --platform linux/arm64 -t darts-evolution:1.4.0 --output type=docker,dest=darts-evolution-arm64.tar .
```

Dans Docker Manager → **Images** → **Ajouter / Importer** le fichier `.tar(.gz)`. Copiez ensuite
seulement `docker/docker-compose.image-only.yml` (renommé `docker-compose.yml`) et `.env.example` dans le
dossier du projet.

## 4. Configurer les variables

Copiez `.env.example` en `.env` dans le dossier du projet et modifiez au minimum :

| Variable | Exemple | Explication |
|---|---|---|
| `APP_PORT` | `8080` | Port d'accès : `http://IP_DU_NAS:8080` |
| `ADMIN_PASSWORD` | un mot de passe solide | Protège sauvegardes, restauration, configuration Autodarts |
| `PUID` / `PGID` | `1000` / `100` | Propriétaire des fichiers dans `data` et `backups` (commande `id` en SSH, ou laissez 1000/1000) |
| `TZ` | `Europe/Paris` | Fuseau horaire des statistiques |
| `AUTODARTS_HOST` | `192.168.1.50` | IP de la machine Autodarts (facultatif : réglable dans l'application) |

Toutes les variables sont décrites dans `.env.example` et dans le README.

## 5. Démarrer les conteneurs

Docker Manager → **Projets** → **Ajouter** :
- nom : `darts-evolution` ;
- chemin : `/Volume1/docker/darts-evolution` ;
- source : **fichier existant** → `docker-compose.yml` ;
- **Valider** puis **Appliquer**.

En SSH (alternative) :

```bash
cd /Volume1/docker/darts-evolution
docker compose up -d --build
```

La politique `restart: unless-stopped` relance automatiquement le conteneur après un incident ou un
redémarrage du NAS.

La première construction prend plusieurs minutes (installation des dépendances, tests, construction de
l'interface). Le réglage `pull_policy: build` indique à Container Manager de construire l'image sur place :
sans lui, il tente de la télécharger sur Docker Hub et échoue (« pull access denied for darts-evolution »).

## 6. Vérifier les journaux

Docker Manager → Conteneurs → `darts-evolution` → **Journaux**. Lignes attendues :

```
Migrations appliquées.
DARTS EVOLUTION 1.4.0 prêt sur http://127.0.0.1:8080 (port 8080).
```

L'état du conteneur doit passer à **sain (healthy)** en moins d'une minute (contrôle de santé intégré).
En SSH : `docker compose logs -f` et `docker ps`.

## 7. Accéder à l'application

Depuis un navigateur du réseau local : **http://IP_DU_NAS:8080** (ex. `http://192.168.1.20:8080`).
Sur téléphone ou tablette, « Ajouter à l'écran d'accueil » donne un accès plein écran.

Premiers pas : **Joueurs → Nouveau joueur**, puis **Jouer**.

## 8. Connecter Autodarts

Paramètres → se connecter en administrateur, puis **Intégration Autodarts** :
1. saisir l'IP de la machine Autodarts, port `3180` ;
2. **Tester la connexion** ;
3. activer l'intégration, **Enregistrer** ; l'état passe à « Connecté ».

## 9. Tester une détection réelle

Suivre la procédure « Test sur le matériel réel » de `docs/autodarts.md` (impacts, retrait,
coupure réseau, doublons). En cas de doute, la saisie manuelle reste disponible à tout moment.

## 10. Configurer les sauvegardes

Paramètres → **Sauvegardes** : fréquence (24 h par défaut), nombre de sauvegardes automatiques
conservées (14 par défaut), **Sauvegarder maintenant**, téléchargement, restauration. Les fichiers sont
dans `/Volume1/docker/darts-evolution/backups/` : incluez ce dossier dans une tâche de sauvegarde TOS
(Hyper Backup, copie vers un autre disque ou un cloud).

---

## Mise à jour depuis l'application (à partir de la 1.2.0)

1. Vérifiez qu'un mot de passe administrateur est défini (`ADMIN_PASSWORD` dans `.env`) et connectez-vous
   dans **Paramètres → Administration**.
2. **Paramètres → Mise à jour de l'application → Installer une mise à jour (.zip)** : choisissez le fichier
   `darts-evolution-X.Y.Z.zip` reçu, **sans le décompresser**, puis confirmez.
3. L'application vérifie le fichier, crée une sauvegarde « Avant mise à jour », installe et redémarre
   (une dizaine de secondes) ; la page se recharge sur la nouvelle version.
4. Si la nouvelle version ne démarre pas, l'ancienne est rétablie automatiquement et le motif s'affiche
   dans la même carte. Le bouton « Revenir à la version … » permet aussi un retour manuel.

Les versions installées ainsi sont rangées dans `data/releases/` (dans le volume de données) : elles
survivent aux redémarrages du conteneur. Une image reconstruite plus récente (mise à jour manuelle) reprend
automatiquement la main. Si un paquet demande un conteneur plus récent, il est refusé : suivez alors la
procédure manuelle ci-dessous.

## Mise à jour manuelle (reconstruction de l'image)

Nécessaire une fois pour passer à la 1.2.0 (le conteneur doit contenir le nouveau lanceur), puis seulement
si un paquet l'exige. Le fichier .zip est le même :

1. Paramètres → **Sauvegarder maintenant** (par précaution).
2. Remplacer les fichiers du projet par la nouvelle version (sans toucher à `data/`, `backups/`, `.env`),
   ou importer la nouvelle image (méthode 2).
3. Projet → **Reconstruire / Redémarrer** (SSH : `docker compose up -d --build`).
4. Au démarrage, si le schéma de base change, une **sauvegarde « Avant mise à jour »** est créée
   automatiquement avant la migration.

Retour arrière : restaurer la sauvegarde « Avant mise à jour » depuis Paramètres → Sauvegardes, avec
l'ancienne version de l'image.

## Restaurer une sauvegarde

Paramètres → Sauvegardes → **Restaurer** (ou « Restaurer depuis un fichier… »). Une sauvegarde de sécurité
de l'état actuel est créée avant. Une sauvegarde provenant d'une version plus récente est refusée.

Restauration manuelle (application arrêtée) :

```bash
docker compose stop
cp backups/darts-evolution-AAAAMMJJ-HHMMSS-manuelle.db data/darts-evolution.db
rm -f data/darts-evolution.db-wal data/darts-evolution.db-shm
docker compose start
```
