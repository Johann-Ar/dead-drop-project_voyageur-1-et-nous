"""
Prépare les médias de la scène (à lancer une fois, depuis spatialbox/) :
  python3 tools/preparer-medias.py
- public/atlas/archives.jpg + archives.json : miniatures des 116 décodages (atlas de textures) ;
- ../data/archives.json : ajoute debut_s (début de l'image dans la piste, en secondes) ;
- public/signal/GR-xxx.bin : le vrai signal de chaque archive, lu dans 384kHzStereo.wav,
  trace par trace (repérée sur le creux de synchro), rééchantillonnée à 400 points par trace
  (= 48 kHz), en int16 little-endian, passages à la suite. Sert aux rubans du mode Signal et au son.
Demande numpy et Pillow. Le .wav (1,4 Go) n'est pas versionné : sans lui, seul l'atlas est produit.
"""
import json, os, re, sys
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SB = os.path.dirname(HERE); ROOT = os.path.dirname(SB)
SR = 384000; TRACES = 540; PER_TRACE = 400; SCALE = 0.4   # int16 = v / SCALE * 32767
arch_path = os.path.join(ROOT, 'data/archives.json')
A = json.load(open(arch_path))

# ── points de départ des images dans les pistes (lus dans voyager.cpp, pour situer les images) ──
src = open(os.path.join(ROOT, 'golden-record-decode/travail/voyager.cpp')).read()
blk = src[src.index('start_points[2]'):]; blk = blk[:blk.index('};')]
SP = []
for c in blk.split('},')[:2]:
    c = re.sub(r'//[^\n]*', '', c.split('{', 2)[-1])
    SP.append([eval(e.strip().replace('audio_sample_rate', str(SR))) for e in c.split(',') if e.strip()])
for r in A['images']:
    ch = 0 if r['piste'] == 'gauche' else 1
    r['debut_s'] = round(SP[ch][r['positions_signal'][0]] / SR, 3)
A['_meta']['debut_s'] = "début de l'image dans sa piste, en secondes (d'après les points de départ du décodeur de Barry)"
json.dump(A, open(arch_path, 'w'), ensure_ascii=False, indent=1)
print('archives.json : debut_s ajouté')

# ── atlas des miniatures ──
TILE = 144; COLS = 11
rows = (len(A['images']) + COLS - 1) // COLS
atlas = Image.new('RGB', (COLS * TILE, rows * TILE), (8, 8, 8)); rects = {}
for i, r in enumerate(A['images']):
    im = Image.open(os.path.join(ROOT, r['fichier_decode'])).convert('RGB')
    im.thumbnail((TILE - 4, TILE - 4), Image.LANCZOS)
    x = (i % COLS) * TILE + (TILE - im.width) // 2; y = (i // COLS) * TILE + (TILE - im.height) // 2
    atlas.paste(im, (x, y))
    rects[r['id']] = [x / atlas.width, y / atlas.height, im.width / atlas.width, im.height / atlas.height]
os.makedirs(os.path.join(SB, 'public/atlas'), exist_ok=True)
atlas.save(os.path.join(SB, 'public/atlas/archives.jpg'), quality=86)
json.dump({'tuile': TILE, 'rects': rects}, open(os.path.join(SB, 'public/atlas/archives.json'), 'w'))
print('atlas :', atlas.size)

# ── signaux réels ──
wav = os.path.join(ROOT, 'golden-record-decode/travail/384kHzStereo.wav')
if not os.path.exists(wav):
    print('pas de .wav : signaux non extraits'); sys.exit(0)
mm = np.memmap(wav, dtype='<f4', mode='r', offset=88).reshape(-1, 2)
out_dir = os.path.join(SB, 'public/signal'); os.makedirs(out_dir, exist_ok=True)
only = set(sys.argv[1:])
index = {}
for r in A['images']:
    if only and r['id'] not in only: continue
    ch = 0 if r['piste'] == 'gauche' else 1
    passes = []
    for f in r['positions_signal']:
        st = SP[ch][f]; x = np.array(mm[st:st + (TRACES + 3) * 3300, ch], dtype=np.float32)
        # même repérage que le décodeur : pic de synchro puis creux du front descendant
        def start(s):
            a = s + int(np.argmax(x[s:s + 190])); return a + int(np.argmin(x[a:a + 190]))
        b = [start(0)]
        for _ in range(TRACES): b.append(start(b[-1] + 3000))
        tr = np.empty((TRACES, PER_TRACE), np.float32)
        for k in range(TRACES):
            seg = x[b[k]:b[k + 1]]
            tr[k] = np.interp(np.linspace(0, len(seg) - 1, PER_TRACE), np.arange(len(seg)), seg)
        passes.append(tr)
    data = np.clip(np.stack(passes) / SCALE * 32767, -32767, 32767).astype('<i2')
    data.tofile(os.path.join(out_dir, r['id'] + '.bin'))
    index[r['id']] = len(passes)
if not only:
    json.dump({'echantillons_par_trace': PER_TRACE, 'traces': TRACES, 'frequence': PER_TRACE * SR // 3195,
               'echelle': SCALE, 'format': 'int16 little-endian, [passage][trace][échantillon]', 'passages': index},
              open(os.path.join(out_dir, 'index.json'), 'w'), indent=1)
print('signaux :', len(index))
