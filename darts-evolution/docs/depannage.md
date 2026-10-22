# Dépannage et diagnostic

## Commandes utiles (SSH sur le NAS, dans le dossier du projet)

```bash
docker ps --filter name=darts-evolution                 # état (Up … (healthy))
docker compose logs --tail 200 -f                        # journaux en direct
docker inspect --format '{{json .State.Health}}' darts-evolution   # détail du contrôle de santé
curl -s http://localhost:8080/api/health                 # santé de l'API (status, base, version, Autodarts)
docker stats darts-evolution --no-stream                 # mémoire / processeur
docker compose restart                                   # redémarrage
docker compose up -d --build                             # reconstruction après mise à jour
docker exec darts-evolution node -e "fetch('http://192.168.1.50:3180/api/version').then(r=>r.text()).then(console.log)"   # le conteneur joint-il Autodarts ?
```

Plus de détails dans les journaux : `LOG_LEVEL=debug` dans `.env`, puis `docker compose up -d`.

## Problèmes fréquents

| Symptôme | Cause probable | Solution |
|---|---|---|
| « pull access denied for darts-evolution » au déploiement | Container Manager cherche l'image sur Docker Hub au lieu de la construire | Utiliser le `docker-compose.yml` à jour (`pull_policy: build`) et vérifier que le dossier du projet contient **toutes** les sources (`Dockerfile`, `apps/`, `packages/`…) ; sinon importer l'image (méthode 2 du guide d'installation) |
| La page ne s'ouvre pas | Port différent, conteneur arrêté | `docker ps` ; vérifier `APP_PORT` ; ouvrir `http://IP_DU_NAS:APP_PORT` |
| Conteneur « unhealthy » | Base inaccessible, droits | Journaux ; vérifier `PUID`/`PGID` et les droits de `data/` |
| `EACCES` / permission refusée dans les journaux | Dossiers créés par un autre utilisateur | Ajuster `PUID`/`PGID` (le conteneur corrige les droits au démarrage) |
| Port déjà utilisé | Une autre application utilise 8080 | Changer `APP_PORT` (ex. 8090) |
| Autodarts « Connexion refusée » | Board Manager arrêté / mauvais port | Démarrer Autodarts ; port 3180 |
| Autodarts « Délai dépassé » | Machine éteinte, autre réseau, pare-feu | `ping` depuis le NAS ; ouvrir le port 3180 |
| Autodarts connecté mais aucun impact | Détection arrêtée, partie non liée, saisie manuelle active, ou lancers non transmis (v2) | Page Intégration : avertissements et journal |
| Impacts ignorés « en attente du retrait » | Fléchettes lancées après une visite terminée | Retirer les fléchettes avant de lancer |
| La 3e fléchette n'est pas comptée (comptée ratée) | Fléchette non détectée par Autodarts (souvent masquée par les deux premières), ou détail non transmis | Toucher « – » dans le bandeau jaune pour la saisir ; Intégration → Autodarts → « Diagnostic des fléchettes manquantes » indique la cause ; recalibrer si les « non détectées » dominent |
| Une ancienne partie gêne les suivantes | Partie quittée sans être terminée (restée « en cours ») | L'abandonner (croix sur l'accueil, ou « Menu » → « Abandonner la partie ») : elle sort des statistiques et de l'historique par défaut |
| Écran figé sur un appareil | Connexion temps réel perdue | Le bandeau rouge l'indique ; la reconnexion est automatique, sinon recharger la page |
| « La partie a été modifiée depuis un autre appareil » | Deux appareils ont validé en même temps | L'affichage est actualisé ; recommencer l'action si nécessaire |
| Mot de passe administrateur oublié | — | Modifier `ADMIN_PASSWORD` dans `.env`, puis `docker compose up -d` |
| Mise à jour : « Définissez d'abord un mot de passe administrateur » | `ADMIN_PASSWORD` vide | Le définir dans `.env`, puis redémarrer le projet |
| Mise à jour : « n'est disponible que dans le conteneur Docker » | Conteneur antérieur à 1.2.0, ou lancement hors Docker | Faire une mise à jour manuelle vers 1.2.0 |
| Mise à jour : « Empreinte incorrecte » / « pas un paquet de mise à jour » | Fichier modifié, décompressé puis recompressé, ou téléchargement incomplet | Renvoyer le fichier .zip d'origine, tel quel |
| Mise à jour : « retour automatique à la version … » | La nouvelle version n'a pas démarré | Journaux du conteneur (`docker compose logs`) ; l'ancienne version fonctionne, rien n'est perdu |
| Version installée par l'application à abandonner | — | Paramètres → « Revenir à la version … », ou supprimer `data/releases/` puis redémarrer |

## Santé de l'API

`GET /api/health` renvoie par exemple :

```json
{"status":"ok","version":"1.7.1","uptimeSeconds":3600,"database":"ok","schemaVersion":4,"autodarts":"connected"}
```

`status` vaut `degraded` (code HTTP 503) si la base SQLite ne répond plus.

## Récupérer les données à la main

La base est un fichier SQLite standard (`data/darts-evolution.db`) : elle peut être ouverte avec
« DB Browser for SQLite » sur un ordinateur (copie, application arrêtée de préférence). Les exports JSON
et CSV de Paramètres → Exports ne nécessitent aucun outil.
