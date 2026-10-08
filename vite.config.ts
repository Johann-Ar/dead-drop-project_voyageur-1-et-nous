/**
 * Vite — racine = ce dossier. Tout ce que la page charge est dans public/ (servi à la racine :
 * /data, /golden-record, /golden-record-decode, /thumbs, /audio, /disque, /fonts, /prelude).
 */
import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';
import { cpSync } from 'node:fs';

// le lien « crédits » du pied de page pointe vers /CREDITS.md : on le copie dans dist/ au build
function copyCredits(): Plugin {
  return { name: 'deaddrop-credits', closeBundle() { cpSync(resolve(__dirname, 'CREDITS.md'), resolve(__dirname, 'dist/CREDITS.md')); } };
}

export default defineConfig({
  plugins: [copyCredits()],
  build: {
    target: 'es2022',
    rollupOptions: { input: { main: resolve(__dirname, 'index.html'), calibration: resolve(__dirname, 'calibration.html') } },
  },
  worker: { format: 'es' },
  server: { port: 5177 },
});
