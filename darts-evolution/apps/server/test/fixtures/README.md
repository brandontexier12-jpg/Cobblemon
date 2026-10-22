# Jeux d'essai du serveur

- `python.zip` : archive produite par le module `zipfile` de Python (implémentation indépendante),
  pour vérifier que le lecteur ZIP de la mise à jour lit d'autres outils que le sien :
  `pkg/hello.txt` (deflate, « Bonjour DARTS EVOLUTION\n » × 50), `pkg/stored.bin` (stocké, octets 0 à 255),
  `pkg/dossier/` (dossier).
- `adpcm-mono.wav`, `adpcm-stereo.wav` : sons de synthèse (sinusoïdes) encodés en Microsoft ADPCM par
  FFmpeg (`-c:a adpcm_ms`), et `*.pcm` : leur décodage par FFmpeg (PCM 16 bits brut), référence du
  décodeur ADPCM des packs de voix.
