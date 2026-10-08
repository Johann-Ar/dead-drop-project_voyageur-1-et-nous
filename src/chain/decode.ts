/**
 * C — Décodage : son → trame.
 *
 * Réimplémentation de la MÉTHODE décrite par Ron Barry (Boing Boing, 2017), sans reprise de
 * son code (son dépôt n'a pas de licence) :
 *  1. repérer le pic de la synchro, puis le bas du front descendant qui suit : c'est le début
 *     fiable d'une trace (les pics seuls alternent de ≈ 3100 à ≈ 3300 échantillons) ;
 *  2. découper la trace en N pixels et faire la moyenne des échantillons de chaque pixel ;
 *  3. convertir la tension en intensité par une courbe en cosinus entre deux bornes,
 *     dans le sens qui corrige le négatif (le blanc est une tension basse).
 * Le décodeur ne reçoit que les échantillons : il ne connaît pas les positions exactes.
 */
import type { Frame, Signal } from './types.ts';
import type { DecodeParams } from './params.ts';

export interface DecodeResult {
  frames: Frame[];
  /** creux de synchro retrouvés (tous passages) — pour l'affichage du mode Signal */
  marks: Int32Array;
}

/** Tension → intensité 0–1. */
export function voltToIntensity(v: number, d: DecodeParams): number {
  let t = (d.upper - v) / (d.upper - d.lower); // 0 = noir, 1 = blanc
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  let i = d.curve === 'cosine' ? (1 - Math.cos(Math.PI * t)) / 2 : t;
  if (!d.invert) i = 1 - i;
  return i;
}

function argmax(x: Float32Array, a: number, b: number): number {
  let best = a, v = -Infinity;
  for (let i = Math.max(a, 0); i < Math.min(b, x.length); i++) if (x[i] > v) { v = x[i]; best = i; }
  return best;
}
function argmin(x: Float32Array, a: number, b: number): number {
  let best = a, v = Infinity;
  for (let i = Math.max(a, 0); i < Math.min(b, x.length); i++) if (x[i] < v) { v = x[i]; best = i; }
  return best;
}

/** Bas du front descendant qui suit le pic de synchro le plus haut dans [from, from + span). */
export function findTraceStart(x: Float32Array, from: number, span: number, window: number): number {
  const peak = argmax(x, from, from + span);
  return argmin(x, peak, peak + window);
}

/**
 * Décode un passage à partir de l'échantillon `from`.
 * `firstSpan` : largeur de la recherche de la toute première synchro.
 */
export function decodePass(x: Float32Array, from: number, d: DecodeParams, firstSpan: number, marks?: Int32Array, markOffset = 0): Frame {
  const frame: Frame = { traces: d.traces, pixels: d.pixels, data: new Float32Array(d.traces * d.pixels) };
  let start = findTraceStart(x, from, firstSpan, d.searchWindow);
  for (let k = 0; k < d.traces; k++) {
    if (marks) marks[markOffset + k] = start;
    const next = findTraceStart(x, start + d.minPeriod, d.searchWindow, d.searchWindow);
    const corr = k % 2 === 0 ? d.evenCorrection : 0;
    const a = start + d.windowStart - corr;
    const w = (d.windowEnd - d.windowStart) / d.pixels;
    for (let p = 0; p < d.pixels; p++) {
      const s0 = Math.floor(a + p * w), s1 = Math.max(Math.floor(a + (p + 1) * w), s0 + 1);
      let sum = 0, n = 0;
      for (let s = s0; s < s1 && s < x.length; s++) { sum += x[s]; n++; }
      frame.data[k * d.pixels + p] = voltToIntensity(n ? sum / n : 0, d);
    }
    start = next;
  }
  return frame;
}

/** Décode tous les passages d'un signal (1 ou 3). */
export function decodeSignal(sig: Signal, d: DecodeParams): DecodeResult {
  const marks = new Int32Array(sig.passStarts.length * d.traces);
  const frames = sig.passStarts.map((ps, i) => {
    const span = (i + 1 < sig.passStarts.length ? sig.passStarts[i + 1] : sig.samples.length) - ps;
    // la première synchro tombe dans la première période et demie du passage
    return decodePass(sig.samples, ps, d, Math.min(span, 4800), marks, i * d.traces);
  });
  return { frames, marks };
}
