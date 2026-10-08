/**
 * Calibration hors navigateur (Node ≥ 22 + sharp) :
 *   node --experimental-strip-types tools/calibrate.ts [dossier racine] [--rounds N] [--rapide] [--depart presets/x.json]
 * --rounds 0 : évalue seulement (n'écrit pas de preset).
 * Lit les 28 paires valides, cherche les paramètres qui rapprochent la simulation des
 * décodages de Barry, écrit presets/barry-2017.json et un rapport docs/calibration-rapport.json.
 */
import sharp from 'sharp';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RGBAImage } from '../src/chain/types.ts';
import type { ChainParams } from '../src/chain/params.ts';
import { runChain } from '../src/chain/pipeline.ts';
import { compare, objective, type Scores } from '../src/calibration/metrics.ts';
import { barryFrame, nasaFrames, type PairInfo, type ArchiveImage } from '../src/calibration/pairs.ts';
import { coordinateDescent, DEFAULT_KNOBS } from '../src/calibration/search.ts';

const args = process.argv.slice(2);
const root = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--rounds' && args[i - 1] !== '--depart') ?? join(import.meta.dirname, '..', '..');
const ri = args.indexOf('--rounds');
const rounds = ri >= 0 ? Number(args[ri + 1]) : 3;
const fast = args.includes('--rapide');
const here = join(import.meta.dirname, '..');

async function load(path: string): Promise<RGBAImage> {
  const { data, info } = await sharp(join(root, path)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data.buffer, data.byteOffset, data.length) };
}

const archives: ArchiveImage[] = JSON.parse(readFileSync(join(root, 'data/archives.json'), 'utf8')).images;
const pairs: PairInfo[] = JSON.parse(readFileSync(join(root, 'data/calibration-pairs.json'), 'utf8')).paires.filter((p: PairInfo) => !p.exclue);
const di = args.indexOf('--depart');
const startFile = di >= 0 ? args[di + 1] : 'presets/depart-calibration.json';
const start: ChainParams = JSON.parse(readFileSync(join(here, startFile), 'utf8'));

const data = await Promise.all(pairs.map(async (pair) => {
  const a = archives.find((x) => x.id === pair.id)!;
  return { pair, nasa: await load(a.fichier_nasa!), ref: barryFrame(await load(a.fichier_decode), pair.orientation) };
}));
const used = fast ? data.filter((_, i) => i % 3 === 0) : data;
console.log(`${data.length} paires chargées, ${used.length} utilisées pour la recherche`);

function scoreAll(p: ChainParams, set = used): { mean: number; per: (Scores & { id: string })[] } {
  const per = set.map(({ pair, nasa, ref }) => {
    const r = runChain(nasaFrames(nasa, pair, p), p);
    return { id: pair.id, ...compare(r.frames[0], ref, pair.frame_rect) };
  });
  return { mean: per.reduce((s, x) => s + objective(x), 0) / per.length, per };
}

const t0 = Date.now();
const before = scoreAll(start, data);
console.log('départ :', before.mean.toFixed(4));
const res = await coordinateDescent(start, DEFAULT_KNOBS, (p) => scoreAll(p).mean, rounds,
  (l) => console.log(`  tour ${l.round} · ${l.path} = ${l.value.toFixed(4)} → ${l.score.toFixed(4)}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`));
const after = scoreAll(res.params, data);
const out = { ...res.params, name: 'Barry 2017', description: `Réglé par calibration sur ${data.length} paires NASA ↔ décodage de Ron Barry (tools/calibrate.ts, ${new Date().toISOString().slice(0, 10)}).` };
if (rounds > 0) writeFileSync(join(here, 'presets/barry-2017.json'), JSON.stringify(out, null, 2) + '\n');
else console.log('(--rounds 0 : rapport seulement, aucun preset écrit)');
const avg = (k: 'mae' | 'ssim' | 'grad', r: typeof after) => r.per.reduce((s, x) => s + x[k], 0) / r.per.length;
const report = {
  date: new Date().toISOString(), paires: data.length,
  avant: { objectif: before.mean, mae: avg('mae', before), ssim: avg('ssim', before), grad: avg('grad', before) },
  apres: { objectif: after.mean, mae: avg('mae', after), ssim: avg('ssim', after), grad: avg('grad', after) },
  par_paire: after.per, journal: res.log,
};
writeFileSync(join(here, 'docs', 'calibration-rapport.json'), JSON.stringify(report, null, 1) + '\n');
console.log('avant', report.avant, '\naprès', report.apres, `\n${((Date.now() - t0) / 1000).toFixed(0)} s`);
