# Modes de jeu et entraînements

Ce document est généré à partir du registre du moteur de jeu (`packages/game-engine/src/registry.ts`) : ce sont exactement les règles appliquées par l'application et affichées dans l'écran « Jouer ».

Tous les modes partagent le même fonctionnement de visite : 3 fléchettes par visite ; « Joueur suivant » termine une visite incomplète en comptant les fléchettes manquantes comme ratées ; avec Autodarts, la visite se termine au retrait des fléchettes. Toute fléchette peut être annulée ou corrigée : la partie est rejouée depuis son journal et les statistiques sont recalculées.

## Jeux

### X01

*301, 501, 701, 901 ou 1001 : descendre exactement à zéro.* — 1 à 8 joueur(s).

- Chaque joueur part du score choisi (301, 501, 701, 901 ou 1001) et retire les points de chaque fléchette.
- Départ simple : toutes les fléchettes comptent. Départ double : rien ne compte avant un double (ou le bull 50). Départ master : avant un double ou un triple.
- Sortie simple : on termine exactement à 0 avec n'importe quelle fléchette. Sortie double : la dernière fléchette doit être un double (ou le bull 50). Sortie master : un double ou un triple.
- Bust : si le score passe sous 0, s'il reste 1 en sortie double/master, ou si 0 est atteint sans la fléchette requise, la visite ne compte pas et le joueur revient au score du début de la visite.
- Le premier à terminer gagne le leg. Le match se joue au premier à N legs (et premier à N sets si les sets sont activés). Le joueur qui commence alterne à chaque leg et à chaque set.

Options par défaut : `{"startScore":501,"inRule":"single","outRule":"double","legs":1,"sets":1,"checkoutStrategy":"classique"}`

### Cricket

*Fermer les numéros 15 à 20 et le bull, marquer des points.* — 1 à 8 joueur(s).

- Numéros en jeu : 15, 16, 17, 18, 19, 20 et le bull. Simple = 1 marque, double = 2, triple = 3 ; bull extérieur = 1 marque, bull intérieur = 2.
- Trois marques ferment un numéro. Les marques supplémentaires rapportent la valeur du numéro (25 pour le bull) tant qu'au moins un adversaire ne l'a pas fermé.
- Classique : les points sont pour le lanceur ; on gagne en ayant tout fermé avec au moins autant de points que chaque adversaire.
- Cut-throat : les points sont infligés aux adversaires qui n'ont pas fermé le numéro ; on gagne en ayant tout fermé avec au plus autant de points que chaque adversaire.
- Limite de manches (optionnelle) : à la fin de la dernière manche, le meilleur total gagne (départage au nombre de marques).

Options par défaut : `{"variant":"standard","maxRounds":20}`

### Count-up

*Premier à atteindre le total visé.* — 1 à 8 joueur(s).

- Chaque fléchette ajoute ses points au total du joueur.
- Le premier joueur qui atteint ou dépasse le total visé gagne immédiatement. Il n'y a pas de bust.

Options par défaut : `{"target":300}`

### High Score

*Le meilleur total après un nombre de manches fixé.* — 1 à 8 joueur(s).

- Chaque joueur joue le même nombre de manches de 3 fléchettes.
- Toutes les fléchettes comptent ; le meilleur total à la fin de la dernière manche gagne (égalité possible).

Options par défaut : `{"rounds":10}`

### Around the Clock

*Toucher les numéros 1 à 20 (puis le bull) dans l'ordre.* — 1 à 8 joueur(s).

- Il faut toucher 1, puis 2, puis 3… jusqu'à 20, puis le bull si l'option est activée.
- Variante de zone : n'importe quelle partie du numéro, simple uniquement, double uniquement ou triple uniquement (au bull, le bull intérieur compte pour double et triple).
- Option « saut » (zone libre) : un double fait avancer de 2 numéros, un triple de 3, sans jamais sauter la dernière cible.
- Le premier à toucher la dernière cible gagne.

Options par défaut : `{"ring":"any","includeBull":true,"skipOnMultiplier":false}`

### Around the World

*Une manche par numéro, de 1 à 20 puis le bull.* — 1 à 8 joueur(s).

- La manche 1 se joue sur le 1, la manche 2 sur le 2… jusqu'au 20, puis une manche sur le bull si l'option est activée.
- Chaque touche du numéro de la manche rapporte son multiplicateur : simple 1, double 2, triple 3 (bull extérieur 1, bull intérieur 2).
- Le meilleur total à la fin gagne.

Options par défaut : `{"includeBull":true}`

### Killer

*Remplir son numéro pour devenir Killer, puis éliminer les adversaires.* — 2 à 8 joueur(s).

- Chaque joueur reçoit un numéro différent, tiré au sort au début de la partie (roue).
- On remplit son numéro pour gagner des vies : simple +1, double +2, triple +3 (zone « doubles » : +1 par double), jusqu'à 3 vies (réglable).
- Avec toutes ses vies, on devient KILLER.
- Un Killer retire des vies en touchant le numéro d'un adversaire : simple 1, double 2, triple 3 (zone « doubles » : 1 par double).
- Un Killer qui repasse sous le maximum de vies perd son statut et doit remplir à nouveau son numéro.
- Un joueur touché alors qu'il n'a plus assez de vies est éliminé (pas d'élimination au premier tour, réglable). Le dernier joueur en jeu gagne.
- Option pénalité : un Killer qui touche son propre numéro perd des vies.
- Variante « classique » : on part avec toutes ses vies et un seul double de son numéro fait Killer.

Options par défaut : `{"variant":"remplissage","lives":3,"firstRoundProtection":true}` (zone « tout le numéro », sans pénalité ; en variante classique : zone « doubles », avec pénalité). Une partie créée avant la version 1.4.0 garde la règle classique.

### Shanghai

*Manche N sur le numéro N ; le Shanghai gagne immédiatement.* — 1 à 8 joueur(s).

- La manche 1 se joue sur le 1, la manche 2 sur le 2, etc. (7 manches par défaut, jusqu'à 20).
- Seules les touches du numéro de la manche comptent : numéro × multiplicateur.
- Shanghai : simple, double et triple du numéro dans la même visite = victoire immédiate (si l'option est active).
- Sinon, le meilleur total après la dernière manche gagne.

Options par défaut : `{"rounds":7,"instantWin":true}`

## Entraînements

### Bob's 27

*Entraînement aux doubles de Bob Anderson : départ à 27 points.* — 1 à 8 joueur(s).

- On part avec 27 points et on joue une visite sur chaque double, de D1 à D20 (puis le bull si l'option est activée).
- Chaque double touché ajoute sa valeur (D1 = 2, D20 = 40, bull = 50).
- Si aucune des trois fléchettes ne touche le double, on retire sa valeur.
- Si le score devient négatif, le joueur est éliminé. Le meilleur score final gagne.

Options par défaut : `{"includeBull":false}`

### Entraînement doubles

*Série de doubles avec taux de réussite.* — 1 à 4 joueur(s).

- Choisissez les doubles (D1 à D20, bull), l'ordre (fixe ou aléatoire) et la progression.
- Progression fixe : N fléchettes par double, on compte les touches. Progression « jusqu'à la touche » : on reste sur le double jusqu'à le toucher (plafond optionnel) et on compte les fléchettes nécessaires.
- Réussite = touches / fléchettes lancées.

Options par défaut : `{"segments":[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],"order":"sequential","progression":"fixed","dartsPerTarget":3,"maxDartsPerTarget":0}`

### Entraînement triples

*Série de triples (T20, T19…) avec taux de réussite.* — 1 à 4 joueur(s).

- Choisissez les triples visés, l'ordre et la progression (comme l'entraînement doubles).
- Seul le triple du numéro compte comme touche. Réussite = touches / fléchettes lancées.

Options par défaut : `{"segments":[20,19,18,17,16,15],"order":"sequential","progression":"fixed","dartsPerTarget":3,"maxDartsPerTarget":0}`

### Entraînement bull

*Manches de 3 fléchettes au bull.* — 1 à 4 joueur(s).

- Chaque manche se compose de 3 fléchettes au bull.
- Cible « bull complet » : bull extérieur (25) et intérieur (50) comptent comme touches. Cible « bull intérieur » : seul le 50 compte.
- Les points (25 ou 50) sont additionnés ; réussite = touches / fléchettes.

Options par défaut : `{"rounds":10,"ring":"any"}`

### Entraînement checkout

*Terminer des scores donnés, avec suivi du taux de réussite.* — 1 à 4 joueur(s).

- Une liste de scores à terminer est tirée au sort (scores réellement terminables) ou saisie.
- Pour chaque score, vous disposez d'un nombre de visites de 3 fléchettes ; les règles de sortie et de bust sont celles du X01.
- Un score est réussi s'il est terminé dans les visites autorisées. Taux de réussite = scores réussis / scores tentés.

Options par défaut : `{"selection":"random","count":10,"min":40,"max":100,"visitsPerTarget":1,"outRule":"double"}`

### Exercice personnalisé

*Votre propre liste de cibles et d'objectifs.* — 1 à 4 joueur(s).

- Définissez une liste de cibles (secteur et zone : simple, double, triple, n'importe quelle zone, bull extérieur ou intérieur).
- Choisissez le nombre de fléchettes par cible, la progression, l'ordre et le nombre de répétitions de la liste.
- Réussite = touches / fléchettes lancées ; un objectif chiffré peut être fixé.
