import { rng, gaussian } from './rng.ts';

export interface WowFlutter {
  wowDepth: number; wowRateHz: number;
  flutterDepth: number; flutterRateHz: number;
  driftDepth: number; seed: number;
}

/**
 * Pleurage (wow, lent) et scintillement (flutter, rapide) : la vitesse de lecture varie,
 * donc le temps se déforme. Le décodeur se recale à chaque synchro, mais à l'intérieur
 * d'une trace les pixels glissent : c'est le tremblement des traces.
 * Profondeurs en échantillons de décalage.
 */
export function wowFlutter(x: Float32Array, sampleRate: number, p: WowFlutter): Float32Array {
  const r = rng(p.seed);
  const g = gaussian(r);
  const phW = r() * 2 * Math.PI, phF = r() * 2 * Math.PI;
  const kW = 2 * Math.PI * p.wowRateHz / sampleRate, kF = 2 * Math.PI * p.flutterRateHz / sampleRate;
  // dérive : marche aléatoire lissée, ramenée vers 0
  let drift = 0, driftV = 0;
  const step = 1 / sampleRate;
  const y = new Float32Array(x.length);
  const N = x.length;
  for (let n = 0; n < N; n++) {
    if ((n & 255) === 0) {
      driftV += g() * Math.sqrt(256 * step) * 40 - driftV * 256 * step * 8;
    }
    drift += driftV * step - drift * step * 2;
    const d = p.wowDepth * Math.sin(kW * n + phW) + p.flutterDepth * Math.sin(kF * n + phF) + p.driftDepth * drift;
    const pos = Math.min(Math.max(n + d, 0), N - 1);
    const i = Math.floor(pos), t = pos - i;
    y[n] = x[i] * (1 - t) + x[Math.min(i + 1, N - 1)] * t;
  }
  return y;
}
