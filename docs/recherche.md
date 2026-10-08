# DEADDROP — dossier de recherche

*Document de travail. Les points marqués **[à vérifier]** doivent être confirmés avant toute diffusion (dates, appels, noms).*

## 1. Question

**Que reste-t-il d'une image après sa transmission ?**

En 1977, 116 images ont été converties en son, gravées sur le Voyager Golden Record et envoyées hors du système solaire. Personne ne les a jamais vues telles qu'un destinataire les verrait : il a fallu attendre 2017 pour que Ron Barry les décode depuis le signal audio. Ce qu'on obtient alors n'est pas la photo d'origine, c'est une image **abîmée par son propre voyage** : stries, glissements, couleurs qui ne se superposent pas.

DEADDROP prend cette perte non comme un défaut à corriger, mais comme **une matière à rendre visible**. Hypothèse : une image transmise est un objet à deux couches, le contenu et la trace du canal ; on peut représenter la seconde sans effacer la première.

Sous-questions :

1. Peut-on **mesurer** la perte d'une transmission analogique image par image, de façon reproductible ?
2. Peut-on en faire la **forme même du rendu**, plutôt qu'un filtre posé dessus ?
3. Qu'est-ce que le public comprend de la transmission quand il y fait passer **sa propre photo** ?

## 2. Positionnement

| Référence | Ce qu'elle apporte | Ce que DEADDROP ajoute |
|---|---|---|
| Hito Steyerl, « In Defense of the Poor Image », *e-flux journal* n° 10, 2009 | La basse résolution comme valeur : l'image pauvre raconte sa circulation. | La pauvreté n'est plus constatée, elle est **simulée, calibrée et mesurée**. |
| Trevor Paglen, *The Last Pictures*, 2012 (disque d'images sur le satellite EchoStar XVI) | Héritier direct du Golden Record : une archive pour un futur lointain. | Le visiteur **ajoute** une image à l'archive et voit ce qu'elle devient. |
| Ron Barry, décodage du Golden Record, 2017 | La méthode pour lire le signal. | Une **chaîne complète** encode → canal → décode, réglée sur ses résultats. |
| Kerbl et al., « 3D Gaussian Splatting for Real-Time Radiance Field Rendering », *ACM TOG* (SIGGRAPH), 2023 | La gaussienne comme primitive de rendu. | Des gaussiennes qui ne représentent pas une scène mais **une transmission** : forme, opacité et position tirées du signal. |

Le Gaussian Splatting sert habituellement à reconstruire le réel le plus fidèlement possible. Ici on l'utilise à contre-emploi : pour montrer **l'écart** entre ce qui a été envoyé et ce qui est arrivé. C'est le point de nouveauté à défendre.

Lien avec le mémoire (« narration spatiale dans les espaces reconstitués du réel ») : DEADDROP est un espace reconstitué dont la reconstruction est **volontairement incomplète**, et dont les manques racontent le trajet.

## 3. Méthode

### 3.1 Une chaîne calibrée

Réimplémentation (sans reprise de code) de la chaîne du disque :

- balayage de l'image en 540 traces × 364 points, période de 3 195 échantillons à 384 kHz, synchro puis creux ;
- canal : passe-haut (couplage AC), passe-bas, bruit blanc et bruit basse fréquence, pleurage/scintillement, décalage pair/impair ;
- décodage selon la méthode de Barry (repérage de la synchro, moyenne par pixel, courbe en cosinus, inversion, correction des traces paires).

**Calibration** sur 28 paires NASA ↔ Barry recalées (2 exclues) : erreur moyenne 0,112 → 0,048, SSIM ≈ 0,69, erreur couleur 0,044 sur 5 paires couleur. La chaîne produit donc des pertes **du même ordre** que celles du disque réel, pas des effets inventés.

### 3.2 La carte de perte

Pour chaque image, une carte 0–1 dit où la transmission a abîmé l'image (`src/app/loss.ts`) :

- **photo d'un visiteur** : écart de luminance entre la trame envoyée et l'image décodée (mesure directe) ;
- **image du disque** : désaccord de chaque trace avec ses deux voisines (mesure sans référence ; une transmission propre varie doucement d'une trace à l'autre).

Normalisation : sous la médiane, rien ; au 98e centile, 1. Seules les vraies blessures ressortent.

### 3.3 Splats natifs du signal

Chaque gaussienne correspond à un morceau de trace :

- **étirée dans le sens des traces** (le balayage de 1977 devient la texture) ;
- **opacité = confiance** du décodage (plus de perte, plus transparent) ;
- **détachement et dérive** le long de la trace = perte mesurée ;
- **flou** croissant avec la perte ;
- **trois nappes R, V, B** pour les images couleur (les trois passages du disque), qui se rejoignent à l'ouverture sans jamais coïncider parfaitement.

Rien n'est appris ni estimé par une IA : tout vient du signal et de la chaîne.

## 4. Évaluation

- **Technique** : corrélation entre la carte de perte sans référence (images du disque) et l'écart réel NASA ↔ Barry sur les 28 paires. *À faire* : si la corrélation est bonne, la mesure sans référence est validée.
- **Perception** : petit test utilisateur (8–12 personnes, non expertes) : montrer une image en rendu classique puis en splats natifs ; demander ce qui est arrivé à l'image. Critère : la personne parle de **transmission / voyage / perte** sans qu'on l'ait dit.
- **Performance** : fluide sur un ordinateur portable ordinaire, sans GPU dédié.

## 5. Protocole physique : graver pour de vrai

Pour fermer la boucle, faire sortir le signal de l'ordinateur :

1. **Exporter** le signal d'une photo (WAV, chaîne sans canal simulé).
2. **Graver** :
   - option A : gravure de disque vinyle (tour de gravure, *lathe cut*) chez un graveur **[à trouver : atelier ou studio de mastering local]** ;
   - option B : gravure laser d'un sillon sur acrylique ou métal (plus accessible, moins fidèle) — FabLab de l'université **[à vérifier]**.
3. **Relire** sur une platine, enregistrer en numérique.
4. **Décoder** avec la chaîne de DEADDROP (décodeur seul).
5. **Comparer** la perte réelle à la perte simulée : c'est la validation la plus forte du projet.

Résultat attendu : quelques images réellement passées par un sillon, montrées à côté des 116.

## 6. Livrables

- **Dépôt open source** : code + dossier. Choisir une licence avant publication (par exemple MIT ou GPL pour le code, CC BY pour les textes) **[à décider]**. Les images NASA gardent leurs crédits ; le code de Ron Barry n'est pas repris.
- **Vidéo** de 2 minutes : une photo qui part, voyage, revient.
- **Article court** (4–8 pages) : question, chaîne calibrée, carte de perte, splats natifs, évaluation.
- **Installation** : écran + platine (si la gravure réelle aboutit).

## 7. Où le montrer

Lieux possibles, tous **[à vérifier : dates, format, frais]** :

- **xCoAx** (Computation, Communication, Aesthetics & X) : art, design et calcul ; accepte articles et œuvres.
- **ISEA** (International Symposium on Electronic Art).
- **IEEE VIS Arts Program (VISAP)** : visualisation et art.
- **SIGGRAPH Art Papers / Art Gallery**.

Localement : présenter le projet à **ICube** (lien avec le stage) pour la partie mesure et rendu.

## 8. Résumé (brouillon, ~150 mots)

> En 1977, 116 images ont quitté la Terre sous forme de son, gravées sur le Voyager Golden Record. Décodées en 2017, elles portent la marque de leur transmission : stries, glissements, couleurs désaccordées. DEADDROP propose de traiter cette perte comme une matière. Nous avons réimplémenté et calibré la chaîne du disque — balayage, canal, décodage — sur 28 paires d'images, ce qui permet à chacun d'y faire passer sa propre photo. Nous en tirons une carte de perte, mesurée avec ou sans image de référence, qui pilote un rendu en gaussiennes : étirées dans le sens des traces, elles se détachent, floutent et pâlissent là où le voyage a abîmé l'image, et les trois passages couleur restent légèrement disjoints. À rebours de l'usage du Gaussian Splatting, qui cherche la fidélité, ce rendu montre l'écart entre ce qui a été envoyé et ce qui est arrivé.

## 9. Prochaines étapes

1. Valider la carte de perte sans référence sur les 28 paires (script à écrire dans `tools/`).
2. Figer un seul préréglage de rendu, retirer le tiroir ⚙.
3. Trouver un lieu de gravure ; faire un premier essai sur une image.
4. Choisir la licence ; publier le dépôt.
5. Vérifier les appels (xCoAx, ISEA, VISAP, SIGGRAPH) et fixer une cible.
