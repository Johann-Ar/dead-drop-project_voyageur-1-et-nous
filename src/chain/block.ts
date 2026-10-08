/**
 * « Bloc de signal » : le format commun aux archives (vrai signal, extrait du .wav par
 * tools/preparer-medias.py) et aux gravures (signal simulé) :
 * [passage][trace][400 échantillons], chaque trace rééchantillonnée entre deux creux de synchro.
 * 400 échantillons par trace de 8,32 ms = 48 075 Hz : le même tableau sert aux rubans 3D et au son.
 */
import type { Signal } from './types.ts';

export const BLOCK_SAMPLES = 400;
export const BLOCK_TRACES = 540;
export const BLOCK_RATE = Math.floor(BLOCK_SAMPLES * 384000 / 3195); // 48 075 Hz

export function signalToBlock(sig: Signal, marks: Int32Array): Float32Array {
  const passes = sig.passStarts.length, T = sig.traces;
  const out = new Float32Array(passes * T * BLOCK_SAMPLES);
  const x = sig.samples;
  for (let pass = 0; pass < passes; pass++) for (let k = 0; k < T; k++) {
    const a = marks[pass * T + k];
    const b = k + 1 < T ? marks[pass * T + k + 1] : a + 3195;
    const len = b - a;
    for (let i = 0; i < BLOCK_SAMPLES; i++) {
      const pos = a + i * (len - 1) / (BLOCK_SAMPLES - 1), i0 = Math.floor(pos), t = pos - i0;
      out[(pass * T + k) * BLOCK_SAMPLES + i] = (x[i0] ?? 0) * (1 - t) + (x[i0 + 1] ?? 0) * t;
    }
  }
  return out;
}

/** int16 (fichiers public/signal/*.bin) → flottants. */
export function blockFromInt16(buf: ArrayBuffer, scale: number): Float32Array {
  const i16 = new Int16Array(buf), out = new Float32Array(i16.length);
  for (let i = 0; i < i16.length; i++) out[i] = i16[i] / 32767 * scale;
  return out;
}

export function blockToInt16(block: Float32Array, scale: number): Int16Array {
  const out = new Int16Array(block.length);
  for (let i = 0; i < block.length; i++) out[i] = Math.max(-32767, Math.min(32767, Math.round(block[i] / scale * 32767)));
  return out;
}

/** Le bloc, joué tel quel : passages à la suite, normalisé pour l'écoute. */
export function blockToAudio(block: Float32Array): Float32Array<ArrayBuffer> {
  let peak = 1e-6;
  for (let i = 0; i < block.length; i++) peak = Math.max(peak, Math.abs(block[i]));
  const out = new Float32Array(block.length), g = 0.85 / peak;
  let mean = 0; for (let i = 0; i < block.length; i++) mean += block[i]; mean /= block.length;
  for (let i = 0; i < block.length; i++) out[i] = (block[i] - mean) * g;
  return out;
}
