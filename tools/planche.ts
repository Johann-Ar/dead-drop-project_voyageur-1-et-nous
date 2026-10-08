/** Planche de contrôle : NASA recalée | simulation | décodage de Barry, pour quelques paires. */
import sharp from 'sharp';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RGBAImage, Frame } from '../src/chain/types.ts';
import type { ChainParams } from '../src/chain/params.ts';
import { runChain } from '../src/chain/pipeline.ts';
import { compare } from '../src/calibration/metrics.ts';
import { barryFrame, nasaFrames, type PairInfo, type ArchiveImage } from '../src/calibration/pairs.ts';

const [root, presetPath, outPath, idsArg] = process.argv.slice(2);
const ids = idsArg ? idsArg.split(',') : ['GR-012', 'GR-063', 'GR-093', 'GR-103', 'GR-110', 'GR-116'];
const load = async (p: string): Promise<RGBAImage> => {
  const { data, info } = await sharp(join(root, p)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data };
};
const archives: ArchiveImage[] = JSON.parse(readFileSync(join(root, 'data/archives.json'), 'utf8')).images;
const pairs: PairInfo[] = JSON.parse(readFileSync(join(root, 'data/calibration-pairs.json'), 'utf8')).paires;
const P: ChainParams = JSON.parse(readFileSync(presetPath, 'utf8'));
const W = 540, H = 364, G = 6;
const canvas = new Uint8Array((W * 3 + G * 2) * (H + G) * ids.length);
const put = (f: Frame, col: number, row: number) => {
  for (let t = 0; t < W; t++) for (let p = 0; p < H; p++)
    canvas[(row * (H + G) + p) * (W * 3 + G * 2) + col * (W + G) + t] = Math.round(f.data[t * H + p] * 255);
};
for (const [row, id] of ids.entries()) {
  const pair = pairs.find((p) => p.id === id)!; const a = archives.find((x) => x.id === id)!;
  const input = nasaFrames(await load(a.fichier_nasa!), pair, P)[0];
  const ref = barryFrame(await load(a.fichier_decode), pair.orientation);
  const sim = runChain([input], P).frames[0];
  const s = compare(sim, ref, pair.frame_rect);
  console.log(id, `mae ${s.mae.toFixed(3)} ssim ${s.ssim.toFixed(3)} grad ${s.grad.toFixed(3)}`);
  put(input, 0, row); put(sim, 1, row); put(ref, 2, row);
}
await sharp(canvas, { raw: { width: W * 3 + G * 2, height: (H + G) * ids.length, channels: 1 } }).jpeg({ quality: 80 }).toFile(outPath);
