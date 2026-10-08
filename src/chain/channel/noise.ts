import { rng, gaussian } from './rng.ts';

/**
 * Bruit de fond :
 * - blanc (souffle, grain de la gravure) : `rms` ;
 * - basse fréquence (dérive lente de la bande, ronflette) : `lowRms`, filtré sous `lowCutoffHz`.
 *   Il décale le niveau de traces entières : ce sont les fines stries verticales des décodages de Barry.
 */
export function addNoise(x: Float32Array, rms: number, seed: number, lowRms = 0, lowCutoffHz = 150, sampleRate = 384000): Float32Array {
  const g = gaussian(rng(seed));
  const y = new Float32Array(x.length);
  // filtre du 1er ordre ; gain compensé pour que `lowRms` soit l'écart-type obtenu
  const a = Math.min(1, 2 * Math.PI * lowCutoffHz / sampleRate);
  const norm = Math.sqrt((2 - a) / a);
  let low = 0;
  for (let n = 0; n < x.length; n++) {
    low += a * (g() - low);
    y[n] = x[n] + rms * g() + lowRms * norm * low;
  }
  return y;
}
