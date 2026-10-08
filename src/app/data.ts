/** Chargement des données : archives et images. */
import type { ArchiveImage } from '../calibration/pairs.ts';

export interface Archive extends ArchiveImage { debut_s: number }

export async function loadArchives(): Promise<Archive[]> {
  const j = await (await fetch('/data/archives.json')).json();
  return j.images;
}

export async function loadBitmap(url: string): Promise<ImageBitmap> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url} : ${r.status}`);
  return createImageBitmap(await r.blob());
}

export async function bitmapToRGBA(bmp: ImageBitmap, maxSide = 1600): Promise<{ width: number; height: number; data: Uint8ClampedArray }> {
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.round(bmp.width * s), h = Math.round(bmp.height * s);
  const c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h);
  return { width: w, height: h, data: d.data };
}
