/**
 * Décale le contenu d'une trace (entre deux synchros) sans déplacer les synchros.
 * Sans cela, le décodeur, qui se recale sur chaque synchro, annulerait le décalage.
 * Un décalage positif retarde l'image (elle descend dans la trace).
 */
export function shiftTraceContent(y: Float32Array, start: number, end: number, shift: number): void {
  if (shift === 0 || end <= start) return;
  const seg = y.slice(start, end);
  const L = seg.length;
  for (let i = 0; i < L; i++) {
    const src = i - shift;
    const s = Math.min(Math.max(src, 0), L - 1);
    const i0 = Math.floor(s), t = s - i0;
    y[start + i] = seg[i0] * (1 - t) + seg[Math.min(i0 + 1, L - 1)] * t;
  }
}
