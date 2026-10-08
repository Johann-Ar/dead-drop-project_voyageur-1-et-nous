"""Contraste des images décodées : étire les niveaux (le gris le plus sombre, 0,5 % des points, devient noir ;
le plus clair, 99,5 %, devient blanc) puis ajoute une légère courbe en S. Refait les vignettes.
Chaque image n'est traitée qu'une fois (liste dans public/thumbs/contraste.json).
Les versions d'avant sont gardées dans _a_supprimer/decode-avant-contraste/.
Usage : python3 tools/contraste-originaux.py [racine du projet]   (racine par défaut : ../..)"""
import json, os, shutil, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..')
SB = os.path.join(HERE, '..')
BACKUP = os.path.join(SB, '_a_supprimer', 'decode-avant-contraste')
MARK = os.path.join(SB, 'public', 'thumbs', 'contraste.json')
S_CURVE = 0.35          # force de la courbe en S (0 : aucune)

done = set(json.load(open(MARK))) if os.path.exists(MARK) else set()
images = json.load(open(os.path.join(ROOT, 'data', 'archives.json'), encoding='utf-8'))['images']
os.makedirs(BACKUP, exist_ok=True)
n = 0
for a in images:
    if a['id'] in done: continue
    path = os.path.join(ROOT, a['fichier_decode'])
    im = Image.open(path); mode = im.mode
    rgb = np.asarray(im.convert('RGB')).astype(np.float32) / 255
    L = rgb @ np.array([0.299, 0.587, 0.114], dtype=np.float32)
    lo, hi = np.percentile(L, 0.5), np.percentile(L, 99.5)
    if hi - lo < 0.05: continue
    v = np.clip((rgb - lo) / (hi - lo), 0, 1)
    s = v + S_CURVE * (v - 0.5) * (1 - np.abs(2 * v - 1))          # courbe en S douce : noirs plus noirs, blancs plus blancs
    out = Image.fromarray((np.clip(s, 0, 1) * 255 + 0.5).astype(np.uint8), 'RGB')
    if mode in ('L', 'LA'): out = out.convert('L')
    keep = os.path.join(BACKUP, os.path.basename(path))
    if not os.path.exists(keep): shutil.copy2(path, keep)
    out.save(path)
    th = out.convert('RGB'); th.thumbnail((480, 480), Image.LANCZOS)
    th.save(os.path.join(SB, 'public', 'thumbs', a['id'] + '.jpg'), quality=82)
    done.add(a['id']); n += 1
json.dump(sorted(done), open(MARK, 'w'))
print(n, 'images contrastées')
