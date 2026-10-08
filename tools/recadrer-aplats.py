"""Recadre les images décodées qui ont des aplats gris uniformes sur les bords (marges du décodage),
refait leurs vignettes et écrit public/thumbs/aspects.json (format réel de chaque image).
Les originaux sont gardés dans _a_supprimer/decode-avant-recadrage/.
Usage : python3 tools/recadrer-aplats.py [racine du projet]   (racine par défaut : ../..)"""
import json, os, shutil, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..')
SB = os.path.join(HERE, '..')
BACKUP = os.path.join(SB, '_a_supprimer', 'decode-avant-recadrage')

def edges(L):
    """Largeur (px) de l'aplat uniforme sur chaque bord : gauche, droite, haut, bas (0 si aucun)."""
    h, w = L.shape
    def run(A, n):
        cs = A.std(0); cm = A.mean(0)
        m = float(np.median(cs[int(n * 0.3):int(n * 0.7)]))
        t = min(0.5 * m, 12.0)
        k = 0
        while k < n // 3 and cs[k] < t: k += 1
        if k < 0.05 * n: return 0
        if cs[k:k + 6].mean() < 1.8 * cs[:k].mean(): return 0   # pas de bord net entre l'aplat et l'image
        if cm[:k].std() > 4.0: return 0                          # l'aplat doit être uniforme
        return k + 2
    return run(L, w), run(L[:, ::-1], w), run(L.T, h), run(L.T[:, ::-1], h)

images = json.load(open(os.path.join(ROOT, 'data', 'archives.json'), encoding='utf-8'))['images']
aspects, done = {}, []
os.makedirs(BACKUP, exist_ok=True)
for a in images:
    path = os.path.join(ROOT, a['fichier_decode'])
    im = Image.open(path)
    L = np.asarray(im.convert('L')).astype(float)
    l, r, t, b = edges(L)
    if any((l, r, t, b)):
        keep = os.path.join(BACKUP, os.path.basename(path))
        if not os.path.exists(keep): shutil.copy2(path, keep)
        w, h = im.size
        im = im.crop((l, t, w - r, h - b)); im.save(path)
        th = im.convert('RGB'); th.thumbnail((480, 480), Image.LANCZOS)
        th.save(os.path.join(SB, 'public', 'thumbs', a['id'] + '.jpg'), quality=82)
        done.append((a['id'], (l, r, t, b)))
    aspects[a['id']] = round(im.size[0] / im.size[1], 4)
json.dump(aspects, open(os.path.join(SB, 'public', 'thumbs', 'aspects.json'), 'w'), indent=0)
print(len(done), 'images recadrées :', ', '.join(i for i, _ in done))
