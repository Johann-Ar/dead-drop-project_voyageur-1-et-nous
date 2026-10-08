/**
 * A0 — Préparation et balayage.
 * Une image (ligne par ligne) devient une trame (trace par trace), comme sous la caméra
 * de la machine de Colorado Video : l'image est lue colonne par colonne, de haut en bas.
 */
import type { Frame, RGBAImage, Channel } from './types.ts';

/** Plan de valeurs 0–1, rangé ligne par ligne (comme une image). */
export interface Plane {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * Orientation au sens du décodeur de Barry (voir data/archives.json) :
 * 0 = paysage, affiché tel quel (540 × 364) ;
 * 1 et 2 = portrait, l'image a été posée couchée sous la caméra.
 */
export type Orientation = 0 | 1 | 2;

/** Extrait un canal (ou la luminance Rec. 709 sur les valeurs gamma) en plan 0–1. */
export function planeFromRGBA(img: RGBAImage, channel: Channel): Plane {
  const n = img.width * img.height;
  const out = new Float32Array(n);
  const d = img.data;
  for (let i = 0; i < n; i++) {
    const r = d[i * 4], g = d[i * 4 + 1], b = d[i * 4 + 2];
    out[i] = (channel === 'r' ? r : channel === 'g' ? g : channel === 'b' ? b
      : 0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/** Recadre un plan : [x0, y0, x1, y1) en pixels. */
export function crop(p: Plane, x0: number, y0: number, x1: number, y1: number): Plane {
  const w = x1 - x0, h = y1 - y0;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(p.data.subarray((y + y0) * p.width + x0, (y + y0) * p.width + x1), y * w);
  return { width: w, height: h, data: out };
}

/** Rééchantillonnage bilinéaire (avec moyenne de zone quand on réduit fortement). */
export function resize(p: Plane, w: number, h: number): Plane {
  let src = p;
  // pré-réduction par 2 successifs pour éviter le crénelage
  while (src.width >= w * 2 && src.height >= h * 2) src = halve(src);
  const out = new Float32Array(w * h);
  const sx = src.width / w, sy = src.height / h;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(Math.max((y + 0.5) * sy - 0.5, 0), src.height - 1);
    const y0 = Math.floor(fy), y1 = Math.min(y0 + 1, src.height - 1), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(Math.max((x + 0.5) * sx - 0.5, 0), src.width - 1);
      const x0 = Math.floor(fx), x1 = Math.min(x0 + 1, src.width - 1), tx = fx - x0;
      const a = src.data[y0 * src.width + x0], b = src.data[y0 * src.width + x1];
      const c = src.data[y1 * src.width + x0], d = src.data[y1 * src.width + x1];
      out[y * w + x] = (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
    }
  }
  return { width: w, height: h, data: out };
}

function halve(p: Plane): Plane {
  const w = p.width >> 1, h = p.height >> 1;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * p.width + 2 * x;
    out[y * w + x] = (p.data[i] + p.data[i + 1] + p.data[i + p.width] + p.data[i + p.width + 1]) / 4;
  }
  return { width: w, height: h, data: out };
}

/**
 * Passe de l'orientation d'affichage à l'orientation « sous la caméra » (paysage),
 * inverse exacte de la rotation d'affichage de Barry.
 */
export function toCameraOrientation(p: Plane, o: Orientation): Plane {
  if (o === 0) return p;
  const W = p.width, H = p.height;
  // l'image couchée : largeur = H, hauteur = W
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    // o = 1 : trace = ligne r, pixel = W-1-c   |   o = 2 : trace = H-1-r, pixel = c
    const t = o === 1 ? r : H - 1 - r;
    const px = o === 1 ? W - 1 - c : c;
    out[px * H + t] = p.data[r * W + c];
  }
  return { width: H, height: W, data: out };
}

/** Inverse de toCameraOrientation : de la trame vers l'affichage (comme les PNG de Barry). */
export function toDisplayOrientation(p: Plane, o: Orientation): Plane {
  if (o === 0) return p;
  const H = p.width, W = p.height; // p est couché : largeur = traces, hauteur = pixels
  const out = new Float32Array(W * H);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) {
    const t = o === 1 ? r : H - 1 - r;
    const px = o === 1 ? W - 1 - c : c;
    out[r * W + c] = p.data[px * H + t];
  }
  return { width: W, height: H, data: out };
}

/** Trame vide au niveau donné (0 = noir). */
export function emptyFrame(traces: number, pixels: number, level = 0): Frame {
  return { traces, pixels, data: new Float32Array(traces * pixels).fill(level) };
}

/**
 * Pose un plan (déjà en orientation caméra) dans une trame, dans le rectangle
 * [trace de départ, pixel de départ, largeur en traces, hauteur en pixels].
 */
export function placeInFrame(p: Plane, frame: Frame, rect: [number, number, number, number]): Frame {
  const [t0, p0, w, h] = rect;
  const r = resize(p, w, h);
  for (let y = 0; y < h; y++) {
    const px = p0 + y;
    if (px < 0 || px >= frame.pixels) continue;
    for (let x = 0; x < w; x++) {
      const t = t0 + x;
      if (t < 0 || t >= frame.traces) continue;
      frame.data[t * frame.pixels + px] = r.data[y * w + x];
    }
  }
  return frame;
}

/** Ajuste un plan dans la trame (« contain »), centré, avec une marge relative. */
export function fitRect(p: Plane, traces: number, pixels: number, margin = 0.06): [number, number, number, number] {
  const aw = traces * (1 - 2 * margin), ah = pixels * (1 - 2 * margin);
  const s = Math.min(aw / p.width, ah / p.height);
  const w = Math.max(1, Math.round(p.width * s)), h = Math.max(1, Math.round(p.height * s));
  return [Math.round((traces - w) / 2), Math.round((pixels - h) / 2), w, h];
}

/** Trame → plan affichable (ligne par ligne), orientation caméra. */
export function frameToPlane(f: Frame): Plane {
  const out = new Float32Array(f.traces * f.pixels);
  for (let t = 0; t < f.traces; t++) for (let p = 0; p < f.pixels; p++) out[p * f.traces + t] = f.data[t * f.pixels + p];
  return { width: f.traces, height: f.pixels, data: out };
}

/** Plan (orientation caméra, largeur = traces) → trame. */
export function planeToFrame(p: Plane): Frame {
  const out = new Float32Array(p.width * p.height);
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) out[x * p.height + y] = p.data[y * p.width + x];
  return { traces: p.width, pixels: p.height, data: out };
}

/** Choisit l'orientation d'une image utilisateur : un portrait est couché (comme sur le disque). */
export function autoOrientation(width: number, height: number): Orientation {
  return height > width ? 1 : 0;
}
