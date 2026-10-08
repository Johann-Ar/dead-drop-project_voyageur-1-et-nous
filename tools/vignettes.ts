/** Vignettes de la grille (480 px de grand côté, JPEG) : node --experimental-strip-types tools/vignettes.ts [racine du projet] */
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const root = process.argv[2] ?? join(import.meta.dirname, '..', '..');
const out = join(import.meta.dirname, '..', 'public', 'thumbs');
mkdirSync(out, { recursive: true });
const images = JSON.parse(readFileSync(join(root, 'data/archives.json'), 'utf8')).images;
let total = 0;
for (const a of images) {
  const info = await sharp(join(root, a.fichier_decode)).resize(480, 480, { fit: 'inside' }).jpeg({ quality: 82, mozjpeg: true }).toFile(join(out, a.id + '.jpg'));
  total += info.size;
}
console.log(images.length, 'vignettes,', (total / 1e6).toFixed(1), 'Mo');
