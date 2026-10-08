/**
 * Tri des splats de l'arrière vers l'avant (tri par comptage sur 16 bits, en O(n)).
 * Indispensable pour la transparence : un splat lointain doit être peint avant un proche.
 */
// tampons réutilisés d'un appel à l'autre (le tri tourne à chaque image : pas d'allocation)
const COUNTS = new Uint32Array(65536);
let KEYS = new Uint16Array(0);
export function sortBackToFront(depth: Float32Array, out: Uint32Array, counts = COUNTS): Uint32Array {
  const n = depth.length;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < n; i++) { const d = depth[i]; if (d < min) min = d; if (d > max) max = d; }
  const scale = max > min ? 65535 / (max - min) : 0;
  counts.fill(0);
  if (KEYS.length < n) KEYS = new Uint16Array(n);
  const keys = KEYS;
  // clé = distance à la caméra (grande = loin) → on range par distance décroissante
  for (let i = 0; i < n; i++) { const k = 65535 - Math.round((depth[i] - min) * scale); keys[i] = k; counts[k]++; }
  let sum = 0;
  for (let k = 0; k < 65536; k++) { const c = counts[k]; counts[k] = sum; sum += c; }
  for (let i = 0; i < n; i++) out[counts[keys[i]]++] = i;
  return out;
}
