/**
 * Cartes de perte : où le voyage a abîmé l'image (0 = intact, 1 = très abîmé).
 *
 * - `lossFromDiff` : pour une photo gravée ici, on connaît l'image avant et après la chaîne.
 *   La perte est l'écart de luminance entre les deux, adouci et normalisé.
 * - `lossFromTraces` : pour les 116 images du disque, on n'a que le résultat du décodage.
 *   On mesure ce que le décodage laisse dans l'image : les traces voisines qui ne s'accordent
 *   pas (stries, sauts de synchro, bruit). Une image bien transmise varie doucement d'une
 *   trace à l'autre ; une trace abîmée se détache de ses voisines.
 * Ces cartes pilotent les splats : détachement, flou et transparence là où la perte est forte.
 */
export interface Pix { data: Uint8ClampedArray | Uint8Array; width: number; height: number }
export interface LossMap { data: Float32Array; width: number; height: number }

const lum = (d: ArrayLike<number>, i: number) => (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;

/** Luminance échantillonnée sur une grille w×h (plus proche voisin). */
function sample(img: Pix, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) * img.height / h));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) * img.width / w));
      out[y * w + x] = lum(img.data, (sy * img.width + sx) * 4);
    }
  }
  return out;
}

/** Flou boîte séparable, rayon r. */
function blur(a: Float32Array, w: number, h: number, r: number): Float32Array {
  const t = new Float32Array(a.length), o = new Float32Array(a.length);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const xx = x + k; if (xx >= 0 && xx < w) { s += a[y * w + xx]; n++; } }
    t[y * w + x] = s / n;
  }
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, n = 0;
    for (let k = -r; k <= r; k++) { const yy = y + k; if (yy >= 0 && yy < h) { s += t[yy * w + x]; n++; } }
    o[y * w + x] = s / n;
  }
  return o;
}

/**
 * Ramène à 0–1 : sous la médiane, rien (l'image reste nette) ; au 98e centile, 1.
 * Seules les vraies blessures de la transmission se détachent.
 */
function normalize(a: Float32Array): Float32Array {
  const s = Array.from(a).sort((p, q) => p - q);
  const lo = s[Math.floor(s.length * 0.5)], hi = Math.max(lo + 1e-4, s[Math.floor(s.length * 0.98)]);
  for (let i = 0; i < a.length; i++) { const t = Math.min(1, Math.max(0, (a[i] - lo) / (hi - lo))); a[i] = t * t * (3 - 2 * t); }
  return a;
}

function grid(img: Pix, long = 180) {
  const k = long / Math.max(img.width, img.height);
  return { w: Math.max(4, Math.round(img.width * k)), h: Math.max(4, Math.round(img.height * k)) };
}

/** Perte mesurée entre l'image avant (`before`) et après (`after`) la chaîne. */
export function lossFromDiff(before: Pix, after: Pix, long = 180): LossMap {
  const { w, h } = grid(after, long);
  const a = sample(before, w, h), b = sample(after, w, h);
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = Math.abs(a[i] - b[i]);
  return { data: normalize(blur(d, w, h, 2)), width: w, height: h };
}

/**
 * Perte estimée depuis le seul résultat : désaccord de chaque trace avec ses deux voisines.
 * `axis` : sens des traces dans l'image affichée ('v' : les traces sont des colonnes).
 */
export function lossFromTraces(img: Pix, axis: 'v' | 'h', long = 360): LossMap {
  const { w, h } = grid(img, long);
  const L = sample(img, w, h), d = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    let a: number, b: number;
    if (axis === 'v') { a = L[y * w + Math.max(0, x - 1)]; b = L[y * w + Math.min(w - 1, x + 1)]; }
    else { a = L[Math.max(0, y - 1) * w + x]; b = L[Math.min(h - 1, y + 1) * w + x]; }
    d[i] = Math.abs(L[i] - (a + b) / 2);
  }
  // on moyenne le long des traces (une trace abîmée l'est sur une longueur), puis on réduit
  const r = 3, s = blur(d, w, h, r);
  return { data: normalize(s), width: w, height: h };
}

/** Sens des traces à l'écran selon l'orientation d'affichage de l'image. */
/**
 * Sens réel des traces, mesuré dans l'image : des traces verticales font varier fortement
 * le profil moyen des colonnes d'une colonne à l'autre ; des traces horizontales, celui des lignes.
 * (L'orientation enregistrée ne correspond pas toujours au sens des dégradations visibles.)
 */
export function detectAxis(img: Pix): 'v' | 'h' {
  const n = 256, L = sample(img, n, n), cm = new Float32Array(n), rm = new Float32Array(n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const v = L[y * n + x]; cm[x] += v; rm[y] += v; }
  let sv = 0, sh = 0;
  for (let k = 1; k < n; k++) { sv += Math.abs(cm[k] - cm[k - 1]); sh += Math.abs(rm[k] - rm[k - 1]); }
  return sv >= sh ? 'v' : 'h';
}

export const traceAxis = (orientation: number): 'v' | 'h' => (orientation === 0 ? 'v' : 'h');
