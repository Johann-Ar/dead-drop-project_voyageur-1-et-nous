# DEADDROP — Plan

> **Refonte du 30/09/2026, après les premiers tests.** L'interface est simplifiée pour un public qui ne connaît rien au projet, et le nom « SpatialBox » est abandonné.
> - La page est une grille 2D, dans l'ordre du sillon, sans filtres.
> - La 3D n'apparaît qu'à l'ouverture d'une image, en splats gaussiens.
> - Sont retirés : la disposition Temps, les filtres, l'écoute, le mode Signal, la bascule NASA, le grand disque 3D, les titres et textes techniques, et l'animation de gravure. Il reste un balayage d'environ 2 s pendant le calcul.
> - Les réglages de rendu restent pour l'instant dans un tiroir temporaire. Voir README.md.
>
> **État au 30/09/2026 (avant la refonte) : les étapes 1 à 8 sont faites.** Un changement par rapport au plan validé : la scène est un **moteur WebGL 2 écrit pour le projet**, et non Three.js WebGPU/TSL. Three.js ne pouvait pas être installé ni testé depuis mes environnements ; ce moteur-là, je l'ai testé dans un vrai navigateur. Three.js n'est plus chargé que pour la vue Spark. Détails dans README.md.

29 septembre 2026. **Validé** : voie B (Vite + npm), disposition Sillon + Temps, polices Steps Mono + Karrik.

---

## 0. Ce que la lecture du dossier change par rapport au brief

| Brief | Ce que contient le dossier | Conséquence |
|---|---|---|
| 47 images NASA | **30** GIF dans `golden-record/` (640 × 480, fond noir, filigrane « NASA » / « UNESCO » sur la gauche) | La calibration porte sur **30 paires**. Elles sont toutes retrouvées : je les ai rapprochées à l'œil, planche par planche. |
| 116 images décodées | 116 fichiers. Piste gauche : G000 → G077 = positions 1 → 54. Piste droite : D002 → D077 = positions 55 → 116. | L'ordre correspond exactement à la liste de Wikipédia (1 = cercle de calibrage, 116 = violon). |
| « 512 traces × ≈ 364 pixels » | Le décodeur de Barry lit **540 traces × 364 pixels**. Son article dit que le glyphe de la pochette indique « 512 » et qu'il a déduit 384 en hauteur (rapport 4:3), puis corrigé « de quelques pour cent ». | Le nombre réel de traces sera **mesuré sur le vrai signal** (voir ci-dessous), pas choisi au hasard. |
| Calibrer sur les images seules | Le vrai signal est dans le dossier : `travail/384kHzStereo.wav` (1,4 Go, 384 kHz, stéréo), avec les instants de début de chaque image dans `voyager.cpp`. | **Double calibration** : sur les images (page `/calibration`) et sur **le son lui-même** (forme de l'impulsion de synchro, longueur des traces, dérive, bande passante, pleurage mesurés sur les 30 images). Bien plus solide. |
| Images couleur | Seules **20** images ont été gravées en trois passages R/V/B. Wikipédia en marque 87 « Color » : beaucoup ont été gravées en N&B. | Pour les images N&B, on compare le décodage à la **luminance** de l'image NASA. `archives.json` garde les deux informations. |
| Spark pour le Gaussian Splatting | Spark (World Labs, licence MIT) cible **WebGLRenderer / WebGL2**. Rien n'indique qu'il marche avec WebGPURenderer. | Le mode « splats » de l'étape 7 tournera dans un **canvas WebGL séparé**, chargé à la demande. Le reste de la scène reste en WebGPU. |

> Observation de design : les décodages de Barry ressemblent déjà à des **bas-reliefs**. Chaque objet a un côté éclairé et un côté dans l'ombre, dans le sens des traces. C'est la signature d'un filtre passe-haut, qui revient à dériver l'image. Le relief 3D ne sera donc pas un effet ajouté : il matérialise une trace physique du canal. C'est un bon argument pour la soutenance.

## 1. La contrainte : pas de paquets depuis mes environnements

Depuis ma session, npm, PyPI, jsDelivr, unpkg et GitHub sont **tous bloqués**, dans le cloud comme sur ton Mac. J'ai en revanche le compilateur TypeScript (`tsc`) et `bun`, qui sert à lancer les tests. D'où deux voies :

**A. Sans installation, comme l'outil Autochrome (recommandée)**
- Le code est écrit en **TypeScript** dans `src/`. Je le compile en JavaScript dans `app/js/`, qui est versionné.
- Three.js (version fixée) arrive dans le navigateur par une *import map* depuis jsDelivr. Tu peux aussi télécharger le fichier une fois dans `vendor/` pour travailler hors ligne.
- On lance le projet avec `lancer.command` (python3 `http.server`), comme Autochrome.
- Rien à installer. Je peux tester moi-même toute la chaîne de simulation (A → B → C, calibration).
- En revanche, **je ne peux pas voir la 3D moi-même** : il faudra ton navigateur, ou le navigateur intégré de l'app Claude quand ton Mac est connecté.

**B. Vite + npm (le standard)**
- Tu lances une fois `npm install` dans ton Terminal. On gagne un vrai bundler, un poids de bundle mesuré précisément et le chargement à la demande des modules.
- Il faut Node sur ton Mac. Et je ne peux pas lancer `npm install` pour vérifier.

On peut commencer en A et passer en B plus tard : les sources TypeScript restent les mêmes.

## 2. Arborescence

```
Deadrop Project/
├─ data/archives.json          ← partagé (Autochrome peut s'en servir)
├─ autochrome/                 ← je n'y touche pas
├─ golden-record/ …            ← je n'y touche pas
└─ spatialbox/
   ├─ index.html               scène principale
   ├─ calibration.html         page /calibration
   ├─ lancer.command
   ├─ README.md  CREDITS.md  PLAN.md
   ├─ presets/                 barry-2017.json · signal-propre.json · longue-distance.json
   ├─ fonts/                   WOFF2 + licences OFL
   ├─ src/
   │  ├─ chain/                ── cœur, sans aucune dépendance, testable
   │  │  ├─ types.ts           Signal, Frame, Params
   │  │  ├─ scan.ts            redimensionnement, balayage en traces, séparation R/V/B
   │  │  ├─ encode.ts          impulsion de synchro + rampe d'intensité → Float32Array
   │  │  ├─ channel/           highpass.ts · lowpass.ts · noise.ts · wowflutter.ts
   │  │  │                     · traceJitter.ts (3100/3300) · rgbShift.ts
   │  │  ├─ decode.ts          détection des traces, moyenne par pixel, courbe cosinus, inversion
   │  │  ├─ compose.ts         triplets → image couleur
   │  │  ├─ wav.ts             export WAV 32 bits flottant (384 kHz) + version audible
   │  │  └─ pipeline.ts        enchaîne A → B → C, avec progression trace par trace
   │  ├─ worker/chain.worker.ts
   │  ├─ calibration/          register.ts (recalage) · metrics.ts · page.ts · search.ts
   │  ├─ scene/                renderer.ts (WebGPU → WebGL2) · disc.ts · relief.ts
   │  │                        · signalRibbons.ts · depth.ts (à la demande) · layouts/
   │  ├─ audio/player.ts       Web Audio, horloge commune avec l'affichage trace par trace
   │  ├─ store/idb.ts          gravures de l'utilisateur (IndexedDB)
   │  └─ ui/                   panneau, filtres, bascule NASA ↔ décodage, exports
   ├─ tests/                   chain.test.ts … (bun test)
   ├─ tools/analyse-signal.ts  lit le vrai .wav → mesures de référence (JSON)
   └─ app/js/                  JavaScript compilé (voie A)
```

## 3. La chaîne de simulation

Chaque module est une fonction pure `(entrée, paramètres) → sortie`, et chaque effet a `enabled: boolean`.

- **A. Encodage** : on balaie l'image en N traces verticales (N mesuré, ≈ 512 à 540). Chaque trace = impulsion de synchro + rampe d'intensité. L'impulsion a la forme mesurée sur le vrai signal : un pic, puis un front descendant 40 à 140 échantillons plus loin, selon Barry. Une trace dure ≈ 3 200 échantillons à 384 kHz. Pour la couleur, on fait trois passages R, V, B à la suite.
- **B. Canal** : passe-haut (couplage AC) en premier, puis passe-bas, bruit, pleurage/scintillement, alternance ≈ 3 100 / 3 300, décalage entre R, V et B. **Chaque paramètre est d'abord estimé sur le vrai signal**, par `tools/analyse-signal.ts`, puis affiné par la calibration sur les images.
- **C. Décodage** : je réimplémente la méthode telle que Barry la décrit. On cherche le maximum, puis le creux du front descendant. On découpe chaque trace en 364 pixels, on fait la moyenne, puis on applique une courbe cosinus entre deux bornes et on inverse. La démarche qui sert de référence est dans CREDITS.md. **Aucune ligne de voyager.cpp n'est copiée**, et les valeurs de bornes sont recalibrées de notre côté.
- **D. Calibration** : on recale l'image NASA sur le décodage. Il faut retirer le cadre noir et le filigrane, gérer la rotation (Barry tourne certaines images) et chercher l'échelle et le décalage. On mesure l'écart moyen, le SSIM et la corrélation des gradients, qui rend compte des ombres. Une recherche automatique règle les paramètres (descente par coordonnées, dans le worker). La page `/calibration` montre les 30 paires côte à côte : NASA, notre simulation, Barry, carte d'écart, curseurs.
- **E. Presets** : trois fichiers JSON. `Barry 2017` est calé sur la calibration, `Signal propre` désactive tous les effets, `Longue distance` pousse les dégradations.

Tout ce calcul tourne dans un Web Worker. Le signal est transféré sans copie (Transferable). Une image couleur pèse environ 540 × 3 200 × 3 échantillons ≈ 20 Mo en Float32, ce qui passe sans problème.

## 4. Volumétrie

- **Rendu** : `WebGPURenderer` + TSL. Il bascule tout seul en WebGL2 si WebGPU n'est pas disponible (documentation Three.js).
- **Relief (mode par défaut)** : un plan subdivisé (≈ 364 × 540), déplacé dans le vertex shader par la luminance, avec un éclairage rasant réglable. Une variante « nuage de points » est possible.
- **Signal** : 540 rubans (x = trace, y = temps, z = amplitude du signal réel ou simulé). Le passage vers le relief morphe chaque ruban en colonne de pixels. C'est la même donnée vue autrement, c'est littéralement la même trace.
- **Profondeur estimée** : Depth Anything V2 Small (licence Apache 2.0) via Transformers.js, en WebGPU, chargé seulement au clic. Puis Spark, dans son canvas WebGL à part.
- **Disque d'or** : géométrie procédurale (sillon en spirale dans la normal map et en légère géométrie), matériau PBR or (métal = 1, rugosité faible, anisotropie si WebGPU). Les motifs sont dessinés par nous, sans copier la pochette. Pendant la gravure, un masque en spirale « remplit » le sillon. Pendant la lecture, la tête suit la spirale et le son joue ; la même horloge audio pilote l'apparition des traces.

**Trois dispositions pour naviguer dans les images** (à choisir) :
1. **Sillon** : les 116 archives sont posées le long de deux spirales entrelacées, piste gauche et piste droite, dans leur ordre sur le disque. Les gravures prolongent la spirale vers l'extérieur, comme de nouveaux sillons. C'est la plus fidèle à l'objet.
2. **Temps du signal** : les images sont empilées comme des coupes le long d'un axe de temps réel (de 15 s à 461 s, d'après les débuts de chaque image). On traverse la pile en volume, et les gravures viennent après 461 s. C'est la plus fidèle au son.
3. **Orbite** : les archives sont réparties sur une coquille autour du disque et les gravures sur une coquille extérieure. Les voisines se ressemblent (similarité calculée à l'avance). C'est la plus exploratoire.

Je propose **1 par défaut, avec 2 en vue alternative**.

## 5. Interface

- **Différenciation** : une archive porte `GR-001…GR-116`, sa piste et sa position, son crédit (ou « crédit à vérifier ») et son lien source. Une gravure porte `DD-AAAAMMJJ-xxxx`. Filtre Tout / Archives / Gravures. Bascule **NASA (envoyé) ↔ Décodage (voyagé)** sur les 30 paires.
- **Palette** : noir profond, gris du signal, or du disque. La couleur n'apparaît qu'avec les 20 images couleur et avec les gravures en couleur.
- **Accessibilité** : mode « à plat » (images, contrôles, son) si WebGL/WebGPU manque ou si `prefers-reduced-motion` est actif. Il reste accessible au clavier.
- **Exports** : PNG décodé, WAV (384 kHz fidèle + version audible à 48 kHz), trois séparations R/V/B.

**Typographie** (hors Google Fonts, fonderies indépendantes, licence SIL OFL 1.1 vérifiée sur les pages de Velvetyne) :
- **Steps Mono** (Jean-Baptiste Morizot & Raphaël Bastide, Velvetyne, 2015) pour les données, positions et libellés. Son dessin fin, sans courbes, rappelle les diagrammes gravés sur la pochette.
- **Karrik** (Jean-Baptiste Morizot & Lucas Le Bihan, Velvetyne, 2020) pour les textes. Un grotesque vernaculaire volontairement imparfait, sur le thème des « villes fantômes ».
- Autre choix possible : **Departure Mono** (Helena Zhang, OFL), déjà utilisée par Autochrome, pour que les deux outils se ressemblent.
- Comme mes téléchargements sont bloqués, **tu devras récupérer les zip** sur velvetyne.fr (lien « Download » de chaque police) et les déposer dans `spatialbox/fonts/`.

## 6. Performance (budget de départ)

- Au démarrage : Three.js WebGPU, la chaîne, l'interface et les miniatures (générées à l'avance en ~128 px, en WebP).
- Depth Anything (≈ 50 Mo) et Spark ne se chargent qu'au clic.
- Je donnerai le poids réel mesuré à chaque étape : taille des fichiers en voie A, rapport du bundler en voie B. Je n'avance aucun chiffre avant de l'avoir mesuré.

## 7. Étapes

1. ✅ Plan + arborescence + `data/archives.json` (116 entrées, crédits vides, `a_verifier: true`).
2. ✅ Mesures sur le vrai .wav (`tools/analyse-signal.py`), recalage des paires (`tools/recalage.py`, 28 valides), chaîne A → B → C + 15 tests + page `/calibration`.
3. ✅ Presets : couleur (5 paires, écart 0,044), stries verticales (bruit basse fréquence, égal à Barry), alternance paire/impaire vérifiée.
4. ✅ Scène WebGL 2 : disque d'or procédural, mode Relief, dispositions Sillon et Temps (coupes), sélection, bascule NASA ↔ décodage.
5. ✅ Mode Signal avec le vrai signal du disque (extrait du .wav), transition continue, lecture Web Audio synchronisée, tête sur le sillon.
6. ✅ Gravure : glisser-déposer, 5 étapes animées, IndexedDB, identifiants DD-AAAAMMJJ-xxxx, cadre or, filtre.
7. ✅ Profondeur estimée (Depth Anything V2 Small, worker, à la demande) en nuage de points ; vue Spark en exploration.
8. ✅ Exports PNG / WAV / R, V, B, mode à plat, résolution adaptative, CREDITS.md, README.md, 21 tests.

## 8. Points d'attention

- **Crédits** : `credit` reste vide. `credit_indice_wikipedia` reprend la mention de la page, relevée automatiquement : **à contrôler** sur Wikipédia et dans *Murmurs of Earth* (Sagan et al., 1978) avant d'être validée. Exemple de doute : « Donona, Taplinger Publishing Co » est sans doute « Donona (Taplinger) ».
- **Git** : ton autre conversation committe dans le même dépôt. Je travaille seulement dans `spatialbox/` et `data/`, et je **ne lance aucune commande git** : c'est toi (ou l'autre conversation) qui committes.
- `14250753.gif` (893 × 817, non suivi par git) : je ne sais pas ce que c'est, je n'y touche pas.

## Sources

- Ron Barry, *How to decode the images on the Voyager Golden Record*, Boing Boing, 2017 — https://boingboing.net/2017/09/05/how-to-decode-the-images-on-th.html
- Wikipédia, *Contents of the Voyager Golden Record* — https://en.wikipedia.org/wiki/Contents_of_the_Voyager_Golden_Record
- Three.js, WebGPURenderer (repli WebGL 2, `forceWebGL`) — https://threejs.org/docs/pages/WebGPURenderer.html
- Spark (MIT, WebGL2) — https://github.com/sparkjsdev/spark · https://sparkjs.dev/docs/
- Depth Anything V2 Small ONNX (Apache 2.0) — https://huggingface.co/onnx-community/depth-anything-v2-small
- Velvetyne : Steps Mono https://velvetyne.fr/fonts/steps-mono/ · Karrik https://velvetyne.fr/fonts/karrik/
