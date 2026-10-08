/** Planche couleur : NASA recalée | simulation | décodage couleur de Barry (paires couleur). */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RGBAImage } from '../src/chain/types.ts';
import type { ChainParams } from '../src/chain/params.ts';
import { runChain } from '../src/chain/pipeline.ts';
import { framesToRGBA } from '../src/chain/compose.ts';
import { compareColor } from '../src/calibration/metrics.ts';
import { barryFramesRGB, nasaFrames, type PairInfo, type ArchiveImage } from '../src/calibration/pairs.ts';

const [root, presetPath, outPath] = process.argv.slice(2);
const load = async (p: string): Promise<RGBAImage> => {
  const { data, info } = await sharp(join(root, p)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
};
const archives: ArchiveImage[] = JSON.parse(readFileSync(join(root, 'data/archives.json'), 'utf8')).images;
const pairs: PairInfo[] = JSON.parse(readFileSync(join(root, 'data/calibration-pairs.json'), 'utf8')).paires.filter((p: PairInfo) => !p.exclue);
const P: ChainParams = JSON.parse(readFileSync(presetPath, 'utf8'));
const rows: Buffer[] = [];
for (const pair of pairs) {
  const a = archives.find((x) => x.id === pair.id)!;
  if (a.type !== 'couleur') continue;
  const input = nasaFrames(await load(a.fichier_nasa!), pair, P, 'couleur');
  const ref = barryFramesRGB(await load(a.fichier_decode), pair.orientation);
  const sim = runChain(input, P).frames;
  console.log(a.id, 'écart couleur', compareColor(sim, ref, pair.frame_rect).toFixed(3));
  const imgs = [input, sim, ref].map((f) => framesToRGBA(f, 0));
  const W = 540, H = 364, row = Buffer.alloc((W * 3 + 12) * H * 4);
  imgs.forEach((im, k) => { for (let y = 0; y < H; y++) im.data.subarray(y * W * 4, (y + 1) * W * 4).forEach((v, i) => { row[(y * (W * 3 + 12) + k * (W + 6)) * 4 + i] = v; }); });
  rows.push(row);
}
const W = 540 * 3 + 12;
await sharp(Buffer.concat(rows), { raw: { width: W, height: 364 * rows.length, channels: 4 } }).jpeg({ quality: 82 }).toFile(outPath);
