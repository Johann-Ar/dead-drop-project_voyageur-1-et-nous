/** Mesure du glissement vertical entre traces voisines (tremblement, alternance paire/impaire) : Barry vs simulation.
 *  node --experimental-strip-types tools/mesure-glissement.ts presets/barry-2017.json [racine] */
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
/** glissement vertical (en pixels, sous-pixel) entre traces voisines, dans le rectangle */
function slips(f: Frame, r: number[]) {
  const [t0, p0, w, h] = r, P = f.pixels, out: number[] = [];
  const d = (t: number, p: number) => f.data[t * P + p + 1] - f.data[t * P + p];
  for (let t = t0 + 4; t < t0 + w - 5; t++) {
    let best = 0, bv = -Infinity; const sc: number[] = [];
    for (let s = -4; s <= 4; s++) { let c = 0; for (let p = p0 + 8; p < p0 + h - 9; p++) c += d(t, p) * d(t + 1, p + s); sc.push(c); if (c > bv) { bv = c; best = s; } }
    const i = best + 4; const a = sc[i - 1] ?? bv, b = sc[i + 1] ?? bv; const den = a - 2 * bv + b;
    out.push(best + (den < 0 ? 0.5 * (a - b) / den : 0));
  }
  return out;
}
const stats = (x: number[]) => { const m = x.reduce((a, b) => a + b, 0) / x.length; const odd = x.filter((_, i) => i % 2), ev = x.filter((_, i) => !(i % 2)); const mo = odd.reduce((a, b) => a + b, 0) / odd.length, me = ev.reduce((a, b) => a + b, 0) / ev.length; const sd = Math.sqrt(x.reduce((a, b, i) => a + (b - (i % 2 ? mo : me)) ** 2, 0) / x.length); return { alternance: +(me - mo).toFixed(3), ecart_type_hors_alternance: +sd.toFixed(3) }; };
const B: number[] = [], S: number[] = [];
for (const pair of pairs.slice(0, 28)) {
  const a = archives.find((x: any) => x.id === pair.id);
  const ref = barryFrame(await load(a.fichier_decode), pair.orientation);
  const sim = runChain(nasaFrames(await load(a.fichier_nasa), pair, P), P).frames[0];
  B.push(...slips(ref, pair.frame_rect)); S.push(...slips(sim, pair.frame_rect));
}
console.log('Barry     ', stats(B)); console.log('simulation', stats(S));
