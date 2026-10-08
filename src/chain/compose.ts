/**
 * Recomposition : trames → image RVBA affichable (orientation d'affichage comprise).
 * Triplet R, V, B → image couleur, comme les « color slides » recomposées par Barry.
 */
import type { Frame, RGBAImage } from './types.ts';
import { frameToPlane, toDisplayOrientation, type Orientation, type Plane } from './scan.ts';

export function framesToRGBA(frames: Frame[], orientation: Orientation = 0): RGBAImage {
  const planes: Plane[] = frames.map((f) => toDisplayOrientation(frameToPlane(f), orientation));
  const { width, height } = planes[0];
  const out = new Uint8ClampedArray(width * height * 4);
  const [r, g, b] = planes.length === 3 ? planes : [planes[0], planes[0], planes[0]];
  for (let i = 0; i < width * height; i++) {
    out[i * 4] = r.data[i] * 255;
    out[i * 4 + 1] = g.data[i] * 255;
    out[i * 4 + 2] = b.data[i] * 255;
    out[i * 4 + 3] = 255;
  }
  return { width, height, data: out };
}
