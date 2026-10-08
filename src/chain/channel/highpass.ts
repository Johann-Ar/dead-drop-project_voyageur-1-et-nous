/**
 * Filtre passe-haut du 1er ordre : modélise un couplage AC (condensateur en série).
 * Sur une image, il « oublie » lentement le niveau moyen : après une zone claire, le signal
 * dérive, ce qui crée l'ombre et l'anti-ombre décrites par Barry, le long de chaque trace
 * et d'une trace à la suivante. Hypothèse à confirmer par la calibration.
 */
export function highpass(x: Float32Array, sampleRate: number, cutoffHz: number): Float32Array {
  const rc = 1 / (2 * Math.PI * cutoffHz);
  const dt = 1 / sampleRate;
  const a = rc / (rc + dt);
  const y = new Float32Array(x.length);
  let prevX = x[0] ?? 0, prevY = 0;
  for (let n = 0; n < x.length; n++) {
    const v = a * (prevY + x[n] - prevX);
    y[n] = v; prevY = v; prevX = x[n];
  }
  return y;
}
