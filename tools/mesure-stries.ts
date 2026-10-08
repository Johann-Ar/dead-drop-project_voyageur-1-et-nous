/** Mesure des stries verticales (variation de niveau d’une trace à l’autre) : Barry vs simulation.
 *  node --experimental-strip-types tools/mesure-stries.ts presets/barry-2017.json [racine] */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Frame } from '../src/chain/types.ts';
import { runChain } from '../src/chain/pipeline.ts';
import { barryFrame, nasaFrames } from '../src/calibration/pairs.ts';
const root = process.argv[3] ?? join(import.meta.dirname, '..', '..');
const P = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const load = async (p: string) => { const { data, info } = await sharp(join(root, p)).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { width: info.width, height: info.height, data }; };
const archives = JSON.parse(readFileSync(join(root, 'data/archives.json'), 'utf8')).images;
const pairs = JSON.parse(readFileSync(join(root, 'data/calibration-pairs.json'), 'utf8')).paires.filter((p: any) => !p.exclue);
/** stries : écart entre la moyenne de chaque trace et la moyenne lissée de ses voisines (hors contenu : on prend la médiane des différences) */
function striae(f: Frame, r: number[]) {
  const [t0, p0, w, h] = r, P = f.pixels; const diffs: number[] = [];
  for (let t = t0 + 3; t < t0 + w - 3; t++) {
    const col: number[] = [];
    for (let p = p0 + 6; p < p0 + h - 6; p++) col.push(f.data[t * P + p] - 0.5 * (f.data[(t - 1) * P + p] + f.data[(t + 1) * P + p]));
    col.sort((a, b) => a - b); diffs.push(col[col.length >> 1]);
  }
  const m = diffs.reduce((a, b) => a + b, 0) / diffs.length;
  return Math.sqrt(diffs.reduce((a, b) => a + (b - m) ** 2, 0) / diffs.length);
}
let sb = 0, ss = 0;
for (const pair of pairs) {
  const a = archives.find((x: any) => x.id === pair.id);
  const ref = barryFrame(await load(a.fichier_decode), pair.orientation);
  const sim = runChain(nasaFrames(await load(a.fichier_nasa), pair, P), P).frames[0];
  sb += striae(ref, pair.frame_rect); ss += striae(sim, pair.frame_rect);
}
console.log('stries Barry', (sb / pairs.length).toFixed(4), ' simulation', (ss / pairs.length).toFixed(4));
