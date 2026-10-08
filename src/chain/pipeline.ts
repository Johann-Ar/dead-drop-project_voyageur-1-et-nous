/**
 * Enchaînement complet : image → trame(s) → son → canal → son abîmé → trame(s) → image.
 */
import type { Frame, RGBAImage, Signal } from './types.ts';
import type { ChainParams } from './params.ts';
import { planeFromRGBA, crop, toCameraOrientation, emptyFrame, placeInFrame, fitRect, autoOrientation, type Orientation, type Plane } from './scan.ts';
import { encodeFrames } from './encode.ts';
import { applyChannel } from './channel/index.ts';
import { decodeSignal } from './decode.ts';

export interface PrepareOptions {
  /** 'auto' : un portrait est couché, comme sur le disque */
  orientation?: Orientation | 'auto';
  /** couleur = 3 passages ; nb = 1 passage (luminance) */
  mode: 'couleur' | 'nb';
  /** rectangle imposé dans la trame (calibration) ; sinon ajustement centré */
  rect?: [number, number, number, number];
  /** remplir toute la trame (recadrage centré, sans bords noirs) au lieu de l'y ajuster */
  cover?: boolean;
  /** recadrage de l'image source avant tout [x0, y0, x1, y1] */
  crop?: [number, number, number, number];
}

export interface Prepared {
  frames: Frame[];
  orientation: Orientation;
}

export function prepareFrames(img: RGBAImage, p: ChainParams, opt: PrepareOptions): Prepared {
  const o: Orientation = opt.orientation === undefined || opt.orientation === 'auto'
    ? autoOrientation(opt.crop ? opt.crop[2] - opt.crop[0] : img.width, opt.crop ? opt.crop[3] - opt.crop[1] : img.height)
    : opt.orientation;
  const chans = opt.mode === 'couleur' ? (['r', 'g', 'b'] as const) : (['l'] as const);
  const frames = chans.map((c) => {
    let plane: Plane = planeFromRGBA(img, c);
    if (opt.crop) {
      const [x0, y0, x1, y1] = opt.crop;
      const out = new Float32Array((x1 - x0) * (y1 - y0));
      for (let y = y0; y < y1; y++) out.set(plane.data.subarray(y * plane.width + x0, y * plane.width + x1), (y - y0) * (x1 - x0));
      plane = { width: x1 - x0, height: y1 - y0, data: out };
    }
    let cam = toCameraOrientation(plane, o);
    const f = emptyFrame(p.encode.traces, p.encode.pixels, 0);
    if (opt.cover && !opt.rect) {
      // comme les images du disque : la photo occupe toute la trame
      const T = p.encode.traces, P = p.encode.pixels, ka = T / P;
      let w = cam.width, h = cam.height;
      if (w / h > ka) w = Math.round(h * ka); else h = Math.round(w / ka);
      const x0 = Math.floor((cam.width - w) / 2), y0 = Math.floor((cam.height - h) / 2);
      cam = crop(cam, x0, y0, x0 + w, y0 + h);
      return placeInFrame(cam, f, [0, 0, T, P]);
    }
    return placeInFrame(cam, f, opt.rect ?? fitRect(cam, p.encode.traces, p.encode.pixels));
  });
  return { frames, orientation: o };
}

export interface ChainResult {
  clean: Signal;
  signal: Signal;
  frames: Frame[];
  marks: Int32Array;
}

export function runChain(frames: Frame[], p: ChainParams): ChainResult {
  const clean = encodeFrames(frames, p.encode);
  const signal = applyChannel(clean, p.channel, p.encode);
  const { frames: out, marks } = decodeSignal(signal, p.decode);
  return { clean, signal, frames: out, marks };
}
