/**
 * Filtre passe-bas : bande passante limitée de la chaîne d'enregistrement.
 * Ordre 1 (RC) ou ordre 2 (Butterworth, biquad de R. Bristow-Johnson).
 */
export function lowpass(x: Float32Array, sampleRate: number, cutoffHz: number, order: 1 | 2): Float32Array {
  const y = new Float32Array(x.length);
  const fc = Math.min(cutoffHz, sampleRate * 0.45);
  if (order === 1) {
    const rc = 1 / (2 * Math.PI * fc), dt = 1 / sampleRate, a = dt / (rc + dt);
    let s = x[0] ?? 0;
    for (let n = 0; n < x.length; n++) { s += a * (x[n] - s); y[n] = s; }
    return y;
  }
  const w0 = 2 * Math.PI * fc / sampleRate, cos = Math.cos(w0), alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
  const a0 = 1 + alpha;
  const b0 = (1 - cos) / 2 / a0, b1 = (1 - cos) / a0, b2 = b0, a1 = -2 * cos / a0, a2 = (1 - alpha) / a0;
  let x1 = x[0] ?? 0, x2 = x1, y1 = x1, y2 = x1;
  for (let n = 0; n < x.length; n++) {
    const v = b0 * x[n] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1; x1 = x[n]; y2 = y1; y1 = v; y[n] = v;
  }
  return y;
}
