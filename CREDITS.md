# Crédits

## Le disque et ses images

- **Voyager Golden Record** (1977) : NASA / Jet Propulsion Laboratory. Comité présidé par Carl Sagan. Sélection des images par Jon Lomberg (voir *Murmurs of Earth*, Sagan et al., 1978).
- **Images NASA** (`golden-record/`) : https://science.nasa.gov/gallery/images-on-the-golden-record/.
  Beaucoup de ces photographies appartiennent à leurs auteurs. Le crédit de chaque image est dans `data/archives.json` : il reste **vide avec `a_verifier: true`** tant qu'il n'a pas été vérifié.
- **Liste des 116 positions** et indices de crédit : Wikipédia, *Contents of the Voyager Golden Record*, https://en.wikipedia.org/wiki/Contents_of_the_Voyager_Golden_Record, licence CC BY-SA 4.0.

- **Photos du disque** (`public/disque/`) — **crédits et licences à vérifier avant diffusion** :
  - recto (`recto.webp`, découpé en `logo.png` et `recto-disque.webp` : logo et animation d'arrivée) : la couverture gravée du disque, image fournie par Radio France, https://www.radiofrance.fr/pikapi/images/5fe15d62-b942-4bc6-b129-ef3b376c98a1/2048 — auteur d'origine à retrouver (probablement NASA/JPL).
  - verso (`verso.jpg`, découpé en `verso-disque.jpg`, puis `verso-mat.jpg` : reflets d'origine atténués et un peu désaturé — le disque de l'interface ; la lumière est recalculée par-dessus) : *The Sounds of Earth*, GPN-2000-001976, NASA, via Wikimedia Commons, https://commons.wikimedia.org/wiki/File:The_Sounds_of_Earth_-_GPN-2000-001976.jpg

## Pré-accueil (`public/prelude/`)
Photographies d'archives NASA (pages vérifiées le 3 oct. 2026) :
- `01-lancement.jpg` — *Voyager 1 Launch (1977)*, PIA17464, 5 sept. 1977, crédit NASA/KSC — https://www.jpl.nasa.gov/images/pia17464-voyager-1-launch-1977/
- `02-sonde.jpg` — *Voyager Testing*, PIA21737, 27 avril 1977, crédit NASA/JPL-Caltech — https://science.nasa.gov/photojournal/voyager-testing/
- `03-disque.jpg` — *Voyager: Installing the Golden Record*, PIA21740, 1977, crédit NASA/JPL-Caltech — https://www.jpl.nasa.gov/images/pia21740-voyager-installing-the-golden-record/
- `04-point-bleu.jpg` — *Solar System Portrait - Earth as 'Pale Blue Dot'*, PIA00452, prise par Voyager 1, crédit NASA/JPL — https://www.jpl.nasa.gov/images/pia00452-solar-system-portrait-earth-as-pale-blue-dot/

## Le décodage et le signal

- **Ron Barry**, *How to decode the images on the Voyager Golden Record*, Boing Boing, 5 septembre 2017 : https://boingboing.net/2017/09/05/how-to-decode-the-images-on-th.html.
  Son décodeur (https://github.com/foodini/voyager) a produit les images de `golden-record-decode/`, qui sont montrées dans l'application.
  Ce dépôt n'a **pas de licence** : **aucune ligne de son code n'est reprise ici**. `src/chain/decode.ts` réimplémente la *méthode* qu'il décrit (repérage de la synchro, moyenne par pixel, courbe en cosinus, inversion). Les valeurs qui simulent son décodage lui sont attribuées : bornes −0,26 / 0,18, correction de 12 échantillons sur les traces paires. Pour situer les images dans le signal (`tools/preparer-medias.py`, `tools/analyse-signal.py`), on lit les tables de points de départ de `voyager.cpp` sans les copier dans le projet.
- **Signal audio d'origine** (384 kHz) : https://archive.org/details/voyager.decode. Les extraits de `public/signal/` en sont tirés.
- **Ozma Records / David Pescovitz** : réédition du Golden Record (2017) et publication de l'article de Ron Barry sur Boing Boing, dont David Pescovitz est co-éditeur.

## Polices

- **TRIAL-Vargas** (Black, Regular, Light) — fonderie alex-creq — **version d'essai (TRIAL)** : voir le contrat de licence (`(alex-creq) EULA.pdf` dans le dossier Typographies). Une licence est à acheter avant toute diffusion publique. Black : titres ; Regular : texte ; Light : informations.

- **Steps Mono** — Jean-Baptiste Morizot & Raphaël Bastide, Velvetyne Type Foundry, 2015 — SIL Open Font License 1.1 — https://velvetyne.fr/fonts/steps-mono/
- **Karrik** — Jean-Baptiste Morizot & Lucas Le Bihan, Velvetyne Type Foundry, 2020 — SIL Open Font License 1.1 — https://velvetyne.fr/fonts/karrik/

Le texte de la licence OFL est à joindre avec les fichiers de police (il se trouve dans chaque zip Velvetyne) dans `public/fonts/`.

## Rendu

Le rendu en splats gaussiens est un moteur WebGL 2 écrit pour ce projet, sans bibliothèque. Il reprend le principe du Gaussian Splatting (Kerbl et al., 2023, « 3D Gaussian Splatting for Real-Time Radiance Field Rendering ») : des gaussiennes triées de l'arrière vers l'avant et mélangées par transparence. Les gaussiennes sont ici posées directement à partir des pixels de l'image ; elles ne sont pas apprises depuis des photos. Leur forme vient du signal (« splats natifs du signal ») : étirées dans le sens des traces, détachées, floues et transparentes selon une carte de perte mesurée (`src/app/loss.ts`). Aucune bibliothèque externe n'est chargée.

## Texture or brossé
- `public/disque/matiere-or.jpg` : texture fournie par l'utilisateur — source et licence : a_verifier

## Sons du Voyager Golden Record
- `public/audio/` (salutations, chant des baleines, musiques) : fichiers fournis par l'utilisateur — source et licences : a_verifier (une partie des musiques est encore sous droits)
