# Applications Windows et téléphone

DARTS EVOLUTION tourne sur le serveur (NAS). Les applications ci-dessous l'affichent comme une vraie
application, avec son icône et sans barre d'adresse. Joueurs, parties, statistiques et carrière restent
sur le serveur : ce sont les mêmes sur le PC, le téléphone et la tablette. Aucune donnée de jeu n'est
enregistrée sur l'appareil.

## Application Windows

### Installation

1. Lancez `DARTS-EVOLUTION-Setup-<version>.exe` (Windows 10 ou 11, 64 bits).
2. L'installateur n'est pas signé numériquement (un certificat de signature est payant, chaque année).
   Windows affiche donc « Windows a protégé votre ordinateur » : cliquez sur **Informations
   complémentaires**, puis **Exécuter quand même**.
3. L'installation se fait en un clic, pour l'utilisateur courant, sans droits administrateur, dans
   `%LOCALAPPDATA%\Programs\DARTS EVOLUTION`. Des raccourcis sont créés sur le bureau et dans le menu
   Démarrer, puis l'application s'ouvre.

### Premier lancement

Indiquez l'adresse du serveur, celle que vous tapez dans le navigateur (par exemple `192.168.1.50:8080`).
Elle est aussi affichée dans **Paramètres → Application sur téléphone**, sous le QR code. Sans port
indiqué, le port 8080 est essayé en premier.

**Rechercher sur le réseau** interroge le port 8080 de toutes les adresses du réseau local du PC (wifi ou
câble, réseaux privés `192.168.x.x`, `10.x.x.x`, `172.16–31.x.x`) et liste les serveurs DARTS EVOLUTION qui
répondent. Un serveur sur un autre port se saisit à la main.

L'adresse est enregistrée dans `%APPDATA%\DARTS EVOLUTION\config.json` avec la taille et la position de la
fenêtre. Aux lancements suivants, l'application ouvre directement le serveur.

### Utilisation

La barre de menus apparaît avec la touche **Alt**.

| Menu | Commande |
|---|---|
| DARTS EVOLUTION | **Accueil** (Alt+Origine), **Changer de serveur…**, Quitter |
| Affichage | **Recharger** (Ctrl+R), **Plein écran** (F11), zoom (Ctrl+= / Ctrl+- / Ctrl+0), **Garder l'écran allumé** |
| Aide | Ouvrir dans le navigateur, outils de développement (Ctrl+Maj+I), À propos |

- **Garder l'écran allumé** (activé par défaut) empêche la mise en veille de l'écran tant que la fenêtre
  est affichée ; il ne s'applique plus quand elle est réduite.
- Les annonces vocales et les sons des scores sont joués sans clic préalable, y compris pour les
  fléchettes détectées par Autodarts.
- Si le serveur ne répond pas (NAS éteint, PC sur un autre réseau, redémarrage après une mise à jour),
  une page « Serveur injoignable » s'affiche et réessaie toutes les 5 secondes ; l'application revient
  seule sur DARTS EVOLUTION dès que le serveur répond.
- Imports et exports (photos, packs de voix, sauvegardes, CSV) ouvrent les fenêtres habituelles de
  Windows.

### Mises à jour

L'application affiche l'interface du serveur : mettre à jour le serveur (Paramètres → Mise à jour) met à
jour ce que montre l'application, sans rien réinstaller sur le PC. Une nouvelle version de l'application
Windows elle-même ne sert que si cette fenêtre change ; il suffit alors de lancer le nouvel installateur.

### Désinstallation

Paramètres de Windows → Applications → **DARTS EVOLUTION** → Désinstaller. Le fichier de réglages
(`%APPDATA%\DARTS EVOLUTION`) est conservé ; les données de jeu, elles, sont sur le serveur.

### Sécurité

- La fenêtre n'affiche que les pages du serveur configuré et l'écran de connexion. Un lien vers un autre
  site s'ouvre dans le navigateur par défaut.
- Les pages du serveur n'ont aucun accès au PC (pas de Node.js, bac à sable Chromium, isolation du
  contexte). Les commandes de l'écran de connexion (adresse, recherche) ne sont acceptées que depuis cet
  écran local.
- Seules les autorisations plein écran, copie dans le presse-papiers et maintien de l'écran allumé sont
  accordées, et uniquement au serveur configuré.
- Les adresses https au certificat invalide (autosigné) sont refusées.

### Construire l'installateur

```bash
cd apps/desktop
npm install          # Electron et electron-builder, propres à ce dossier (hors installation du serveur)
npm start            # lance l'application en développement
npm run dist:win     # installateur dans apps/desktop/release/DARTS-EVOLUTION-Setup-<version>.exe
```

`npm run dist:win` fonctionne sous Windows, Linux ou macOS, sans Wine : le désinstallateur est extrait de
l'installateur par le lecteur d'electron-builder (`UninstallerReader`), comme electron-builder le fait déjà
sous macOS. La version est celle du `package.json` racine. Les icônes (`apps/desktop/build/icon.ico`,
`icon.png`) et celles de l'application téléphone sont produites à partir de `apps/web/public/logo.svg` par
`scripts/generate-icons.mjs` (Playwright requis), seulement si le logo change.

Le dossier `apps/desktop` n'est pas un espace de travail npm de la racine : `npm install` à la racine, le
conteneur Docker et les mises à jour du serveur ne téléchargent pas Electron. Ses tests (adresse du
serveur, recherche sur le réseau) font partie de `npm test` ; sa vérification TypeScript se lance avec
`npm run typecheck` dans `apps/desktop`.

## Application sur téléphone et tablette

Il n'y a rien à télécharger depuis un magasin d'applications : DARTS EVOLUTION s'installe depuis le
navigateur et s'ouvre ensuite depuis son icône, en plein écran.

1. Sur le PC, ouvrez **Paramètres → Application sur téléphone** : un QR code contient l'adresse du
   serveur. Scannez-le avec l'appareil photo du téléphone, connecté au wifi de la maison.
2. Ajoutez la page à l'écran d'accueil :
   - **iPhone / iPad** : dans **Safari**, bouton Partager (carré avec une flèche) → « Sur l'écran
     d'accueil » → « Ajouter ». L'application s'ouvre ensuite en plein écran.
   - **Android** : dans **Chrome**, menu ⋮ → « Ajouter à l'écran d'accueil » ou « Installer
     l'application ».

Si la page de Paramètres est ouverte avec `localhost` ou `127.0.0.1`, le QR code n'est pas affiché :
ouvrez-la avec l'adresse du NAS.

### Adresse en http et Android

Chrome n'installe une application complète (plein écran, sans barre d'adresse) que pour une adresse
sécurisée (`https`). Avec l'adresse habituelle du NAS en `http://192.168.x.x:8080`, « Ajouter à l'écran
d'accueil » crée un raccourci qui s'ouvre dans Chrome. Deux possibilités pour une application complète :

- **Adresse https** : par exemple via le proxy inverse du NAS avec un certificat valide. Le service worker
  s'active alors et affiche une page « Serveur injoignable » quand le téléphone est hors du wifi de la
  maison, avec nouvel essai automatique.
- **Réglage de Chrome** (prévu pour les développeurs) : `chrome://flags/#unsafely-treat-insecure-origin-as-secure`,
  saisir l'adresse exacte du serveur (`http://192.168.1.50:8080`), choisir « Enabled », relancer Chrome,
  puis menu ⋮ → « Installer l'application ». Le réglage ne concerne que l'adresse indiquée.

Safari sur iPhone et iPad ouvre l'application en plein écran même avec une adresse en http.

### Fichiers

`apps/web/public/manifest.webmanifest` (nom, icônes, couleurs, raccourcis Jouer, Entraînement, Carrière,
Statistiques), `icons/` (192 et 512 px, icône masquable Android, icône iPhone 180 px), `sw.js` et
`offline.html`. Le service worker ne met aucune page ni donnée en cache, hormis la page hors ligne : après
une mise à jour du serveur, les téléphones affichent tout de suite la nouvelle version. Le serveur sert
ces fichiers avec `Cache-Control: no-cache`.
