/**
 * Mesures d'écart entre notre simulation et le décodage de Barry, dans le rectangle
 * où l'image NASA a été recalée (hors de ce rectangle, on ne sait pas ce qui a été gravé).
 */
import type { Frame } from '../chain/types.ts';

export type Rect = [number, number, number, number]; // [trace, pixel, largeur, hauteur]

export interface Scores {
  /** écart moyen par canal R, V, B (paires couleur seulement) */
  color?: number;
  /** écart absolu moyen, 0–1 (0 = identique) */
  mae: number;
  /** similarité structurelle moyenne (fenêtres 8×8), −1–1 (1 = identique) */
  ssim: number;
  /** corrélation des dérivées le long des traces : rend compte des ombres et des bords */
  grad: number;
}

function clampRect(f: Frame, r: Rect, inset = 4): Rect {
  const t0 = Math.max(0, r[0] + inset), p0 = Math.max(0, r[1] + inset);
  const t1 = Math.min(f.traces, r[0] + r[2] - inset), p1 = Math.min(f.pixels, r[1] + r[3] - inset);
  return [t0, p0, Math.max(0, t1 - t0), Math.max(0, p1 - p0)];
}

export function compare(sim: Frame, ref: Frame, rect: Rect): Scores {
  const [t0, p0, w, h] = clampRect(ref, rect);
  const P = ref.pixels;
  let sad = 0, n = 0;
  for (let t = t0; t < t0 + w; t++) for (let p = p0; p < p0 + h; p++) { sad += Math.abs(sim.data[t * P + p] - ref.data[t * P + p]); n++; }

  // SSIM par fenêtres 8×8 (constantes usuelles pour des valeurs 0–1)
  const C1 = 0.01 ** 2, C2 = 0.03 ** 2;
  let ssimSum = 0, ssimN = 0;
  for (let t = t0; t + 8 <= t0 + w; t += 8) for (let p = p0; p + 8 <= p0 + h; p += 8) {
    let ma = 0, mb = 0;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { ma += sim.data[(t + i) * P + p + j]; mb += ref.data[(t + i) * P + p + j]; }
    ma /= 64; mb /= 64;
    let va = 0, vb = 0, cov = 0;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) {
      const a = sim.data[(t + i) * P + p + j] - ma, b = ref.data[(t + i) * P + p + j] - mb;
      va += a * a; vb += b * b; cov += a * b;
    }
    va /= 63; vb /= 63; cov /= 63;
    ssimSum += ((2 * ma * mb + C1) * (2 * cov + C2)) / ((ma * ma + mb * mb + C1) * (va + vb + C2));
    ssimN++;
  }

  // corrélation des dérivées le long de la trace (axe du temps)
  let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, m = 0;
  for (let t = t0; t < t0 + w; t++) for (let p = p0 + 1; p < p0 + h; p++) {
    const a = sim.data[t * P + p] - sim.data[t * P + p - 1];
    const b = ref.data[t * P + p] - ref.data[t * P + p - 1];
    sa += a; sb += b; saa += a * a; sbb += b * b; sab += a * b; m++;
  }
  const cov = sab / m - (sa / m) * (sb / m);
  const grad = cov / Math.sqrt(Math.max((saa / m - (sa / m) ** 2) * (sbb / m - (sb / m) ** 2), 1e-12));

  return { mae: n ? sad / n : 1, ssim: ssimN ? ssimSum / ssimN : 0, grad };
}

/** Carte d'écart signée, pour l'affichage : gris = identique, clair = simulation plus claire. */
export function diffFrame(sim: Frame, ref: Frame, gain = 2.5): Frame {
  const data = new Float32Array(ref.data.length);
  for (let i = 0; i < data.length; i++) data[i] = Math.min(1, Math.max(0, 0.5 + gain * (sim.data[i] - ref.data[i])));
  return { traces: ref.traces, pixels: ref.pixels, data };
}

/** Écart moyen par canal (R, V, B) — seulement pour les paires couleur. */
export function compareColor(sim: Frame[], ref: Frame[], rect: Rect): number {
  let s = 0;
  for (let c = 0; c < 3; c++) s += compare(sim[c], ref[c], rect).mae;
  return s / 3;
}

/** Score unique à minimiser : écart moyen + pénalité si la structure (ombres, bords) diffère. */
export function objective(s: Scores): number {
  return s.mae + 0.15 * (1 - s.ssim) + 0.1 * (1 - s.grad);
}
