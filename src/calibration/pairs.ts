/**
 * Paires de calibration : image NASA (ce qu'on a envoyé) ↔ décodage de Barry (ce qui a voyagé).
 * data/calibration-pairs.json donne, pour chaque paire, le recadrage de l'image NASA et
 * sa place dans la trame (calculés par tools/recalage.py, vérifiés à l'œil).
 */
import type { Frame, RGBAImage } from '../chain/types.ts';
import type { ChainParams } from '../chain/params.ts';
import { planeFromRGBA, toCameraOrientation, planeToFrame, type Orientation } from '../chain/scan.ts';
import { prepareFrames } from '../chain/pipeline.ts';
import type { Rect } from './metrics.ts';

export interface PairInfo {
  id: string;
  orientation: Orientation;
  nasa_crop: [number, number, number, number];
  frame_rect: Rect;
  scale: [number, number];
  score: number;
  exclue: boolean;
  note?: string;
}

export interface ArchiveImage {
  id: string;
  position: number;
  titre_en: string;
  titre_fr?: string;
  piste: 'gauche' | 'droite';
  positions_signal: number[];
  type: 'nb' | 'couleur';
  orientation: Orientation;
  fichier_decode: string;
  separations_rvb: string[];
  fichier_nasa: string | null;
  credit: string;
  credit_indice_wikipedia: string;
  a_verifier: boolean;
  source: string;
}

/** Le décodage de Barry, ramené en trame (orientation caméra), en luminance. */
export function barryFrame(img: RGBAImage, o: Orientation): Frame {
  return planeToFrame(toCameraOrientation(planeFromRGBA(img, 'l'), o));
}

/** Le décodage couleur de Barry : ses trois passages R, V, B. */
export function barryFramesRGB(img: RGBAImage, o: Orientation): Frame[] {
  return (['r', 'g', 'b'] as const).map((c) => planeToFrame(toCameraOrientation(planeFromRGBA(img, c), o)));
}

/** Luminance Rec. 709 d'un triplet de trames (ou la trame elle-même en N&B). */
export function lumaFrame(frames: Frame[]): Frame {
  if (frames.length === 1) return frames[0];
  const [r, g, b] = frames;
  const data = new Float32Array(r.data.length);
  for (let i = 0; i < data.length; i++) data[i] = 0.2126 * r.data[i] + 0.7152 * g.data[i] + 0.0722 * b.data[i];
  return { traces: r.traces, pixels: r.pixels, data };
}

/** L'image NASA posée dans une trame vide, comme sous la caméra de 1977. */
export function nasaFrames(img: RGBAImage, pair: PairInfo, p: ChainParams, mode: 'nb' | 'couleur' = 'nb'): Frame[] {
  return prepareFrames(img, p, { mode, orientation: pair.orientation, rect: pair.frame_rect, crop: pair.nasa_crop }).frames;
}
