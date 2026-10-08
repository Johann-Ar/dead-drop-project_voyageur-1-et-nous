/**
 * A — Encodage : trame → son, sur le modèle de la machine de Colorado Video (1977).
 *
 * Chaque trace = [repos] [rampe d'intensité des pixels] [repos] [impulsion de synchro → creux].
 * Le creux de la synchro est le repère que le décodeur retrouve. Le blanc est une tension
 * négative, le noir une tension positive (d'où les négatifs de Barry avant inversion).
 * Une image couleur = trois passages à la suite (rouge, vert, bleu), comme sur le disque.
 */
import type { Frame, Signal } from './types.ts';
import type { EncodeParams, SyncShape } from './params.ts';

/** Position du creux de synchro de la trace k (périodes alternées, comme mesuré). */
export function traceMark(k: number, e: EncodeParams): number {
  return k * e.period - (k % 2 === 1 ? e.alternation / 2 : 0);
}

/** Durée d'un passage en échantillons (amorce comprise). */
export function passLength(e: EncodeParams): number {
  return Math.ceil((e.traces + e.leadInTraces + 1) * e.period);
}

/** Valeur de la synchro à la position relative d (d < 0 : avant le creux ; d = 0 : le creux). */
export function syncValue(d: number, s: SyncShape, porch: number): number | null {
  if (d < -s.length || d > s.recovery) return null;
  if (d > 0) return s.dip + (porch - s.dip) * (d / s.recovery);
  if (d === 0) return s.dip;
  const u = (d + s.length) / s.length; // 0 → 1 le long du plateau
  let v = s.level;
  if (u < 0.07) v = s.leadSpike + (s.level - s.leadSpike) * (u / 0.07);
  else if (u > 0.8) v = s.level + (s.tailBump - s.level) * Math.sin(Math.PI * (u - 0.8) / 0.2 * 0.5);
  return v;
}

function intensityToVolt(i: number, e: EncodeParams): number {
  const c = Math.min(Math.max(i, 0), 1);
  return e.black + (e.white - e.black) * Math.pow(c, e.gamma);
}

/**
 * Encode une ou plusieurs trames (1 = N&B, 3 = R, V, B) en un seul signal continu.
 * La rampe suit les pixels de la trace de haut en bas, par interpolation linéaire
 * (le balayage d'une caméra est continu, pas en marches).
 */
export function encodeFrames(frames: Frame[], e: EncodeParams): Signal {
  const L = passLength(e);
  const samples = new Float32Array(L * frames.length);
  const traceMarks = new Int32Array(frames.length * e.traces);
  const passStarts: number[] = [];
  const win = e.windowEnd - e.windowStart;

  frames.forEach((f, pass) => {
    if (f.traces !== e.traces || f.pixels !== e.pixels) throw new Error(`trame ${f.traces}×${f.pixels} ≠ paramètres ${e.traces}×${e.pixels}`);
    const base = pass * L;
    passStarts.push(base);
    samples.fill(e.porch, base, base + L);
    // m_k = creux de la synchro qui ouvre la trace k ; m_traces ferme la dernière
    const first = base + e.leadInTraces * e.period;
    const mark = (k: number) => Math.round(first + traceMark(k, e));
    const writeSync = (m: number) => {
      for (let d = -e.sync.length; d <= e.sync.recovery; d++) {
        const v = syncValue(d, e.sync, e.porch);
        if (v !== null && m + d >= base && m + d < base + L) samples[m + d] = v;
      }
    };
    for (let k = 0; k < e.traces; k++) {
      const m = mark(k);
      traceMarks[pass * e.traces + k] = m;
      writeSync(m);
      // rampe d'intensité
      const col = f.data.subarray(k * f.pixels, (k + 1) * f.pixels);
      for (let s = 0; s < win; s++) {
        const pos = (s / win) * f.pixels - 0.5;
        const p0 = Math.min(Math.max(Math.floor(pos), 0), f.pixels - 1);
        const p1 = Math.min(p0 + 1, f.pixels - 1);
        const t = Math.min(Math.max(pos - p0, 0), 1);
        samples[m + e.windowStart + s] = intensityToVolt(col[p0] * (1 - t) + col[p1] * t, e);
      }
    }
    writeSync(mark(e.traces));
  });

  return { sampleRate: e.sampleRate, samples, passStarts, traces: e.traces, traceMarks };
}
