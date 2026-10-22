# Statistiques : définitions et formules

Toutes les mesures sont **calculées à partir des visites réellement enregistrées** (table `match_visits`,
dérivée du journal d'événements de chaque partie). Les parties marquées **simulation** et les parties
**abandonnées** sont exclues (ces dernières restent consultables dans l'historique ; rien n'est supprimé).
Les parties en cours ou gardées pour plus tard comptent.
Une correction ou une annulation rejoue la partie et réécrit ses visites : les statistiques, records,
badges et niveaux sont donc toujours cohérents (rien n'est cumulé à part).

Code : `packages/statistics/src/` (tests : `packages/statistics/test/statistics.test.ts`).

## X01

| Mesure | Formule |
|---|---|
| Moyenne par fléchette (PPD) | points retenus ÷ fléchettes lancées |
| **Moyenne 3 fléchettes** | moyenne par fléchette × 3 |
| Moyenne par visite | points retenus ÷ nombre de visites |
| Moyenne de 1re visite | moyenne des points de la première visite de chaque leg |
| Moyenne des 9 premières fléchettes | points des 3 premières visites de chaque leg ÷ leurs fléchettes × 3 |
| Meilleure visite | maximum des points d'une visite (hors bust) |
| 180 / 140+ / 100+ | 180 en 3 fléchettes ; 140 à 179 ; 100 à 139 (classes **disjointes**) |
| Réussite aux doubles | checkouts réussis ÷ fléchettes « à la sortie » (X01 double sortie) |
| Taux de checkout | legs terminés ÷ visites commencées sur un score terminable en 3 fléchettes |
| Meilleur checkout | plus grand score restant terminé en une visite |
| Fléchettes par leg gagné | fléchettes du joueur dans chaque leg qu'il a terminé, en moyenne |
| Busts | visites annulées par un bust |

Précisions :
- **Bust** : la visite compte 0 point, ses fléchettes comptent (elles ont été lancées).
- **Fléchettes manquantes** (visite terminée par « Joueur suivant » ou par le retrait) : comptées comme
  ratées, donc incluses dans les moyennes.
- Une fléchette est « **à la sortie** » quand, juste avant de la lancer, le score restant pouvait être
  terminé en une fléchette (≤ 40 et pair, ou 50) et que le score était ouvert.
- La **moyenne par visite** et la **moyenne 3 fléchettes** diffèrent quand une visite compte moins de
  3 fléchettes (checkout en 1 ou 2 fléchettes) : elles ne sont jamais mélangées.

## Résultats

- Parties, victoires, défaites, égalités : **parties terminées à au moins 2 joueurs**. Une partie avec
  plusieurs gagnants dont le joueur fait partie est une égalité.
- Taux de victoire = victoires ÷ parties ; série en cours / record de série : victoires consécutives
  (ordre chronologique de fin).

## Entraînements

| Mesure | Formule |
|---|---|
| Réussite doubles | touches ÷ fléchettes en entraînement doubles et Bob's 27 |
| Réussite triples | touches ÷ fléchettes en entraînement triples |
| Réussite au bull | (25 + 50) ÷ fléchettes en entraînement bull ; part du 50 suivie à part |
| Checkouts réussis | scores terminés ÷ scores tentés (entraînement checkout) |
| Précision (graphique) | touches ÷ fléchettes, tous entraînements à cible confondus |
| Cricket : marques par manche | marques comptées ÷ visites |

## Progression, records, badges

- **Séries temporelles** : regroupement par jour, semaine (lundi → dimanche) ou mois, dans le fuseau
  horaire du serveur (variable `TZ`).
- **Comparaison de périodes** : mêmes formules sur deux intervalles ; l'écart est affiché avec ▲/▼ et un
  libellé (jamais la couleur seule).
- **Records** : meilleure visite, meilleur checkout, meilleure moyenne sur une partie (9 fléchettes min.),
  leg le plus court, nombre de 180, meilleur Bob's 27, Around the Clock le plus rapide, meilleure séance de
  doubles (30 fléchettes min.).
- **Niveau** : XP = 1 par fléchette + 25 par leg gagné + 50 par victoire + 20 par partie/séance terminée
  + 100 par badge ; seuil du niveau n = 100 × (n − 1)².
- **Badges** : attribués d'après les données réelles (premier 180, checkout ≥ 100, 170, leg de 501 en
  15 fléchettes ou moins, 1 000 fléchettes, 3 victoires de suite, 7 jours d'entraînement, etc.).
- **Objectifs hebdomadaires** : fléchettes, séances, parties, moyenne, réussite aux doubles, taux de
  checkout, mesurés sur la semaine en cours.

## Graphiques et couleurs

Palette validée pour le fond sombre (`#141416`) avec l'outil de validation de palettes (contraste,
séparation pour les daltonismes, bande de luminosité) :
- série unique : orange `#e8641a` ;
- comparaison de joueurs (≤ 4 séries, ordre fixe) : `#3987e5`, `#d95926`, `#199e70`, `#c98500`, avec
  légende ;
- calendrier (intensité) : rampe orange `#7d3a14` → `#ffb37a`, jours vides en gris.

Chaque graphique propose une vue tableau (« Voir le tableau ») et une info-bulle au survol.
