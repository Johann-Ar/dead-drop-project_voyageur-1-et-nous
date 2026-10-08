# DEADDROP

Les images du **Voyager Golden Record** (1977), revenues sur Terre. On peut y ajouter sa propre photo : elle passe par tout le processus du disque, simulé en numérique (balayage → son → gravure → lecture → décodage), et en ressort avec le même rendu que les images décodées par Ron Barry en 2017.

L'interface s'adresse à des gens qui ne connaissent rien au projet. Une page, une grille d'images, un bouton, et rien d'autre à comprendre.

## Lancer le projet

Il faut **Node 22.6 ou plus récent** (`node -v` dans le Terminal).

```bash
cd ~/Documents/"Deadrop Project"/spatialbox-propre
npm install        # une seule fois
npm run dev        # puis ouvrir http://localhost:5177
```

| Commande | Rôle |
|---|---|
| `npm test` | tests de la chaîne et du rendu (tri des splats, identifiants…) |
| `npm run typecheck` | vérification TypeScript |
| `npm run build` | version statique dans `dist/` |

**Polices** (Velvetyne, OFL 1.1) : télécharge Steps Mono et Karrik sur velvetyne.fr et copie les `.woff2` dans `public/fonts/` (noms dans `public/fonts/LISEZ-MOI.txt`).

## L'expérience

- **La page** est une grille 2D de toutes les images, sans texte, dans l'ordre du sillon. Les photos ajoutées arrivent en tête, comme un nouveau sillon gravé à l'extérieur du disque, là où la lecture commence. Elles ont un fin cadre or.
- **Cliquer sur une image** l'ouvre en volume : des « splats » gaussiens (des taches floues posées dans l'espace) se condensent et forment l'image. Ses gris lui donnent son relief. On peut tourner autour en glissant, et elle oscille lentement toute seule. Les flèches passent d'une image à l'autre, ↓ l'enregistre, × ou Échap ferme.
- **Ajouter une photo** (bouton, ou glisser-déposer n'importe où) : la photo apparaît en volume et une ligne dorée la « lit » de gauche à droite pendant environ 2 secondes, le temps du calcul. Elle se défait puis se reforme avec le rendu du disque, et rejoint la grille. Elle est enregistrée dans le navigateur (pas de serveur).
- Le logo, un petit disque d'or en 2D, tourne pendant le traitement.

## Le rendu : des splats natifs du signal

Chaque gaussienne décrit un morceau de la transmission, pas un pixel. Elle est étirée dans le sens des traces (le balayage vertical de 1977), et elle se détache, floute et pâlit là où le voyage a abîmé l'image. Cette perte est **mesurée** : pour une photo ajoutée, c'est l'écart entre l'image avant et après la chaîne ; pour les 116 images du disque, c'est le désaccord de chaque trace avec ses voisines (stries, sauts de synchro). Les images couleur arrivent en trois nappes R, V, B — les trois passages du disque — qui se rejoignent. Voir `docs/recherche.md`.

## Réglages de rendu (temporaires)

Le bouton ⚙ en bas à droite ouvre un tiroir **pour tester les rendus**. Les réglages sont gardés dans le navigateur :

- **Rendu des photos ajoutées** : Barry 2017, Signal propre ou Longue distance ;
- **Gris → perte du signal** (0 : relief par les gris ; 1 : splats natifs du signal), **Étirement le long des traces**, **Dérive des parties abîmées** ;
- **Taille des splats, Netteté, Désordre, Détachement, Flottement, Densité** ;
- **Couleur en trois passages R, V, B** (trois nappes qui se rejoignent à l'ouverture) ;
- **Oscillation lente** ;
- lien vers la **page de calibration**.

Quand le bon rendu est choisi, on fige ces valeurs dans `DEFAULT_LOOK` (`src/scene/splats.ts`) et dans le preset par défaut, puis on retire le bouton.

## Technique

- **Rendu** : WebGL 2 écrit pour le projet (`src/scene/splats.ts`), sans bibliothèque. Environ 49 000 splats par image. Chacun est une gaussienne en alpha prémultiplié, et ils sont triés de l'arrière vers l'avant (tri par comptage) quand le point de vue change. La résolution s'adapte si l'ordinateur peine.
- **Chaîne** (`src/chain/`, dans un Web Worker) : encodage en son (540 traces, 8,32 ms par trace, mesuré sur le vrai signal), canal (couplage AC, bande passante, bruit, pleurage, alternance, décalage R/V/B), décodage selon la méthode de Ron Barry. Preset « Barry 2017 » calibré sur 28 paires NASA ↔ Barry : écart moyen 0,048, SSIM 0,69, couleur 0,044 (voir `docs/calibration-rapport.json` et `/calibration.html`).
- **Poids** : le code tient en quelques dizaines de Ko. Les vignettes pèsent 1,6 Mo pour les 116 et se chargent au fil du défilement. L'image en grand se charge à l'ouverture.

## Organisation

Le dossier se suffit à lui-même : tout ce que la page charge est dans `public/`.

```
spatialbox-propre/
├─ index.html · calibration.html     les deux pages
├─ src/app/          page, visionneuse, réglages, stockage (IndexedDB), son
├─ src/scene/        splats gaussiens, tri, utilitaires WebGL
├─ src/chain/        la chaîne A → B → C
├─ src/worker/       calcul de la chaîne
├─ src/calibration/  page et outils de calibration
├─ src/styles/       feuilles de style
├─ presets/          Barry 2017 · Signal propre · Longue distance · Départ calibration
├─ public/
│  ├─ data/                         archives.json (les 116 images), paires de calibration
│  ├─ golden-record/                30 images NASA d'origine (ce qu'on a envoyé)
│  ├─ golden-record-decode/         décodages de Ron Barry (images/)
│  ├─ thumbs/                       vignettes GR-001…GR-116 + aspects.json
│  ├─ audio/                        salutations, musiques, baleines + index.json
│  ├─ disque/                       logo, favicon, matières du disque
│  ├─ fonts/                        Vargas (essai), Bagerich (démo) — voir LISEZ-MOI
│  └─ prelude/                      photos du pré-accueil (à déposer, voir LISEZ-MOI)
├─ docs/             recherche.md · plan.md · calibration-rapport.json
├─ tests/
└─ tools/            calibration, mesures, extraction des médias
```

Les scripts de `tools/` travaillent sur les sources brutes (le `.wav` de 1,4 Go dans `golden-record-decode/travail/`, etc.) : par défaut ils lisent le dossier parent `Deadrop Project/`, qui les contient.

## Limites

- **Crédits** : les crédits des 116 images restent « à vérifier » (`public/data/archives.json`).
- **Photos ajoutées** : elles ne vivent que dans le navigateur qui les a créées.

Crédits : `CREDITS.md`.
