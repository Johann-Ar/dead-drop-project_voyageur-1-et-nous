/** Conversions d'images en fichiers (PNG / JPEG) pour l'enregistrement des gravures. */
import type { RGBAImage } from '../chain/types.ts';

export async function rgbaToBlob(img: RGBAImage, type = 'image/png', quality?: number): Promise<Blob> {
  const c = new OffscreenCanvas(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c.convertToBlob({ type, quality });
}

export async function bitmapToBlob(bmp: ImageBitmap, maxSide: number, type = 'image/jpeg', quality = 0.9): Promise<Blob> {
  const s = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.round(bmp.width * s), Math.round(bmp.height * s));
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  return c.convertToBlob({ type, quality });
}
