/**
 * Recherche automatique des paramètres : descente par coordonnées.
 * Chaque paramètre est essayé plus petit / plus grand ; on garde ce qui fait baisser
 * l'écart moyen sur les paires ; le pas diminue quand plus rien ne s'améliore.
 */
import type { ChainParams } from '../chain/params.ts';

export interface Knob {
  /** chemin dans ChainParams, ex. "channel.highpass.cutoffHz" */
  path: string;
  min: number;
  max: number;
  /** pas initial ; multiplicatif si log = true */
  step: number;
  log?: boolean;
}

export const DEFAULT_KNOBS: Knob[] = [
  { path: 'channel.highpass.cutoffHz', min: 1, max: 600, step: 2, log: true },
  { path: 'channel.lowpass.cutoffHz', min: 3000, max: 150000, step: 1.6, log: true },
  { path: 'encode.gamma', min: 0.4, max: 2.5, step: 0.25 },
  { path: 'encode.white', min: -0.3, max: -0.02, step: 0.03 },
  { path: 'encode.black', min: 0.0, max: 0.25, step: 0.03 },
  { path: 'channel.evenOdd.samples', min: -30, max: 30, step: 6 },
];

export function getAt(p: ChainParams, path: string): number {
  return path.split('.').reduce<any>((o, k) => o[k], p) as number;
}
export function setAt(p: ChainParams, path: string, v: number): void {
  const ks = path.split('.'); const last = ks.pop()!;
  const o = ks.reduce<any>((o, k) => o[k], p); o[last] = v;
}

export interface SearchLog { round: number; path: string; value: number; score: number }

/**
 * `evaluate` renvoie le score moyen (plus bas = mieux) pour un jeu de paramètres.
 * Peut être synchrone (Node) ou asynchrone (Worker).
 */
export async function coordinateDescent(
  start: ChainParams,
  knobs: Knob[],
  evaluate: (p: ChainParams) => number | Promise<number>,
  rounds = 4,
  onStep?: (l: SearchLog) => void,
): Promise<{ params: ChainParams; score: number; log: SearchLog[] }> {
  let best = structuredClone(start);
  let bestScore = await evaluate(best);
  const log: SearchLog[] = [];
  const steps = knobs.map((k) => k.step);
  for (let r = 0; r < rounds; r++) {
    for (let i = 0; i < knobs.length; i++) {
      const k = knobs[i];
      let improved = true;
      while (improved) {
        improved = false;
        const cur = getAt(best, k.path);
        for (const dir of [-1, 1]) {
          let v = k.log ? cur * Math.pow(steps[i], dir) : cur + dir * steps[i];
          v = Math.min(k.max, Math.max(k.min, v));
          if (v === cur) continue;
          const cand = structuredClone(best); setAt(cand, k.path, v);
          const s = await evaluate(cand);
          if (s < bestScore - 1e-5) {
            best = cand; bestScore = s; improved = true;
            const l = { round: r, path: k.path, value: v, score: s }; log.push(l); onStep?.(l);
            break;
          }
        }
      }
      steps[i] = k.log ? Math.sqrt(steps[i]) : steps[i] / 2;
    }
  }
  return { params: best, score: bestScore, log };
}
