/**
 * VOYAGEUR 1 — la page.
 * Deux vues des mêmes images : le disque (par défaut, après l'accueil) et la galerie (ordre au hasard,
 * tiré à chaque ouverture). Un clic ouvre l'image en volume. « Ajouter image ou son » fait passer une
 * photo par la chaîne (balayage → son → gravure → lecture → décodage) ; un son rejoint les musiques.
 */
import { loadArchives, loadBitmap, bitmapToRGBA, type Archive } from './data.ts';
import { listGravures, saveGravure, newGravureId, listSons, saveSon, type Gravure } from './store.ts';
import { rgbaToBlob, bitmapToBlob } from './exports.ts';
import { Viewer, levelById } from './viewer.ts';
import { DiscCarousel } from './carousel.ts';
import { paintSpace, twinkle } from './space.ts';
import { prelude } from './prelude.ts';
import { welcome, spinNear, lastSpin } from './welcome.ts';
import { platine } from './audio.ts';
import { refletIcones } from './reflet.ts';
import { loadSettings, buildSettingsPanel, type Settings } from './settings.ts';
import { PRESETS } from '../presets.ts';
import type { Request, Response, EngraveResult } from '../worker/protocol.ts';
import type { RGBAImage } from '../chain/types.ts';
import { lossFromDiff, lossFromTraces, detectAxis, type LossMap } from './loss.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const stage = $('#stage'), grid = $('#grid'), viewerEl = $('#viewer'), status = $('#status');

type Item =
  | { kind: 'archive'; id: string; a: Archive; aspect: number }
  | { kind: 'gravure'; id: string; g: Gravure; aspect: number };

let items: Item[] = [];
let current = -1;
let currentBitmap: ImageBitmap | null = null;
let busy = false;
const settings: Settings = loadSettings();
const viewer = new Viewer($<HTMLCanvasElement>('#scene'), settings);
viewer.autoMotion = settings.motion;
const lossCache = new Map<string, LossMap>();

// ─── worker de la chaîne ──────────────────────────────────────────────────────
const worker = new Worker(new URL('../worker/chain.worker.ts', import.meta.url), { type: 'module' });
let jobs = 0;
function engrave(image: RGBAImage, preset: string, mode: 'nb' | 'couleur'): Promise<EngraveResult> {
  const job = ++jobs;
  return new Promise((resolve, reject) => {
    const on = (e: MessageEvent<Response>) => {
      const r = e.data;
      if (r.type === 'engraved' && r.job === job) { done(); resolve(r); }
      else if (r.type === 'error' && (r.job === undefined || r.job === job)) { done(); reject(new Error(r.message)); }
    };
    const fail = () => { done(); reject(new Error('le calcul en arrière-plan a échoué')); };   // le worker plante : on ne reste pas bloqué
    const done = () => { worker.removeEventListener('message', on); worker.removeEventListener('error', fail); };
    worker.addEventListener('message', on); worker.addEventListener('error', fail);
    const req: Request = { type: 'engrave', job, image, params: PRESETS[preset] ?? PRESETS['barry-2017'], mode, orientation: 'auto', leger: true };
    worker.postMessage(req, [image.data.buffer as ArrayBuffer]);
  });
}

// ─── grille ───────────────────────────────────────────────────────────────────
function thumbSrc(it: Item): string {
  return it.kind === 'archive' ? `/thumbs/${it.id}.jpg` : urlFor(it.g.thumb, it.id + '-t');
}
const urls = new Map<string, string>();
function urlFor(b: Blob, key: string) { let u = urls.get(key); if (!u) { u = URL.createObjectURL(b); urls.set(key, u); } return u; }

// deux affichages : la grille (par défaut) ou le disque (option)
type Vue = 'grille' | 'disque';
let vue: Vue = (() => { try { return localStorage.getItem('deaddrop-vue') === 'disque' ? 'disque' : 'grille'; } catch { return 'grille'; } })();
let carousel: DiscCarousel | null = null;
const vueBtn = $<HTMLButtonElement>('#vue-btn');
function setVue(v: Vue, garde = false) {
  vue = v;
  try { localStorage.setItem('deaddrop-vue', v); } catch { /* stockage indisponible */ }
  document.body.classList.toggle('vue-disque', v === 'disque');
  if (v === 'grille') { grid.hidden = false; if (!garde) stage.hidden = true; } else { stage.hidden = false; if (!garde) grid.hidden = true; }   // garde : l'autre vue reste le temps du fondu
  vueBtn.setAttribute('aria-pressed', String(v === 'disque'));
  vueBtn.setAttribute('aria-label', v === 'disque' ? 'Afficher la grille' : 'Afficher le disque');
  if (v === 'disque' && !carousel) { carousel = new DiscCarousel(stage, carouselArrive && document.body.classList.contains('welcome')); carousel.onOpen = (i) => open(i); }
  renderGrid();
}
let switching = false;
vueBtn.addEventListener('click', async () => {
  if (switching) return; switching = true;
  try {
  const frame2 = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  if (vue === 'disque') {
    // la galerie se pose par-dessus le disque : son fond noir apparaît et le cache, le disque ne disparaît pas
    melanger(); grid.classList.add('cache', 'bascule');
    setVue('grille', true);
    // les premières vignettes sont décodées AVANT le fondu : il ne saccade pas
    const imgs = [...grid.querySelectorAll('img')].slice(0, 30) as HTMLImageElement[];
    await Promise.race([Promise.allSettled(imgs.map((im) => im.decode())), wait(700)]);
    for (const c of grid.children) c.classList.add('in');
    await frame2(); grid.classList.remove('cache');
    await wait(950); grid.classList.remove('bascule'); if ((vue as Vue) === 'grille') stage.hidden = true;
  } else {
    // la galerie s'efface et découvre le disque, resté à sa place
    const y = scrollY;
    grid.classList.add('bascule');
    setVue('disque', true);
    grid.style.transform = `translateY(${scrollY - y}px)`;   // si le défilement est remis à zéro, la galerie reste quand même où elle était pendant qu'elle s'efface
    await frame2(); grid.classList.add('cache');
    await wait(950); if ((vue as Vue) === 'disque') grid.hidden = true; grid.classList.remove('cache', 'bascule'); grid.style.transform = '';
  }
  } finally { switching = false; }   // une erreur ne bloque jamais le bouton
});

// la galerie s'affiche dans un ordre au hasard, tiré de nouveau à chaque ouverture de la vue
let ordre = new Map<string, number>();
function melanger() { ordre = new Map(items.map((it) => [it.id, Math.floor(Math.random() * 1e6)])); }
function rang(id: string) { let r = ordre.get(id); if (r === undefined) { r = Math.floor(Math.random() * 1e6); ordre.set(id, r); } return r; }

function renderGrid() {
  if (vue === 'disque') { renderDisc(); return; }
  grid.innerHTML = '';
  items.forEach((it, i) => {
    const b = document.createElement('button');
    b.className = 'cell' + (it.kind === 'gravure' ? ' mine' : '');
    b.style.setProperty('--a', String(it.aspect));
    b.style.setProperty('--i', String(Math.min(i, 40)));
    b.style.order = String(rang(it.id));   // affichage dans un ordre au hasard
    b.setAttribute('aria-label', it.kind === 'gravure' ? 'Ta photo, gravée' : `Image ${it.a.position} du disque`);
    const img = document.createElement('img');
    img.src = thumbSrc(it); img.alt = ''; img.loading = i < 24 ? 'eager' : 'lazy'; img.decoding = 'async';
    img.onload = () => b.classList.add('in');
    b.append(img);
    b.addEventListener('click', () => open(i));
    grid.append(b);
  });
  const filler = document.createElement('span'); filler.className = 'filler'; grid.append(filler);
}

function titleOf(it: Item) {
  return it.kind === 'gravure'
    ? `${it.g.titre} · ${new Date(it.g.date).toLocaleDateString('fr-FR')}`
    : `${String(it.a.position).padStart(3, '0')} — ${it.a.titre_fr || it.a.titre_en}`;
}

function renderDisc() {
  carousel?.setItems(items.map((it) => ({
    id: it.id, thumb: thumbSrc(it), aspect: it.aspect, mine: it.kind === 'gravure',
    label: it.kind === 'gravure' ? 'Ta photo, gravée' : `Image ${it.a.position} du disque`,
    title: titleOf(it),
  })));
}

// ─── visionneuse ──────────────────────────────────────────────────────────────
async function bitmapOf(it: Item): Promise<ImageBitmap> {
  return it.kind === 'archive' ? loadBitmap('/' + it.a.fichier_decode) : trimDark(await createImageBitmap(it.g.decoded));
}

/** Retire les bords noirs ajoutés autour d'une image (anciennes gravures) : jamais de cadre. */
async function trimDark(b: ImageBitmap): Promise<ImageBitmap> {
  const w = b.width, h = b.height, c = new OffscreenCanvas(w, h), g = c.getContext('2d')!;
  g.drawImage(b, 0, 0);
  const d = g.getImageData(0, 0, w, h).data;
  const lit = (x: number, y: number) => { const i = (y * w + x) * 4; return d[i] + d[i + 1] + d[i + 2] > 3 * 26; };
  const rowOn = (y: number) => { let n = 0; for (let x = 0; x < w; x += 2) if (lit(x, y)) n++; return n > w * 0.02; };
  const colOn = (x: number) => { let n = 0; for (let y = 0; y < h; y += 2) if (lit(x, y)) n++; return n > h * 0.02; };
  let y0 = 0, y1 = h - 1, x0 = 0, x1 = w - 1;
  while (y0 < y1 && !rowOn(y0)) y0++;
  while (y1 > y0 && !rowOn(y1)) y1--;
  while (x0 < x1 && !colOn(x0)) x0++;
  while (x1 > x0 && !colOn(x1)) x1--;
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return b;
  if (x1 - x0 < w * 0.3 || y1 - y0 < h * 0.3) return b;
  return createImageBitmap(b, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Vignette sans bords noirs (gravures) : adresse et format. */
async function trimmedThumb(g: Gravure): Promise<{ url: string; aspect: number } | null> {
  try {
    const b = await trimDark(await createImageBitmap(g.thumb));
    const c = new OffscreenCanvas(b.width, b.height); c.getContext('2d')!.drawImage(b, 0, 0);
    const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.88 });
    return { url: URL.createObjectURL(blob), aspect: b.width / b.height };
  } catch { return null; }
}

// ─── image agrandie : l'image cliquée grossit au centre, sans quitter l'accueil ──────
let carouselArrive = false;   // le disque attend la fin de l'accueil (de profil, invisible)
let focused = -1;          // image agrandie (−1 : aucune)
let moving = 0;            // transitions en cours

function showViewer() {
  document.body.classList.add('viewing');
  if (viewerEl.hidden) { viewerEl.hidden = false; viewer.start(); }
}

/** Ouvre l'image i (si une autre est ouverte, elle retourne à sa place pendant que i grossit). */
async function open(i: number, rotate = false) {
  if (busy || moving > 0 || !items.length) return;
  i = (i + items.length) % items.length;
  if (i === focused) return;
  const prev = focused;
  if (rotate) carousel?.goTo(i);           // le disque continue de tourner : l'image suivante passe au centre
  if (prev >= 0 && !viewerEl.hidden) {     // changement d'image (flèches) : la précédente rentre dans sa plaque, à l'envers de son apparition
    moving++; try { await viewer.vanish(); } finally { moving--; }
  }
  await enter(i, 0);
}

const FADE = 450;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** L'image i apparaît en volume, au premier plan, sans bouger l'interface du disque. */
async function enter(i: number, delay: number) {
  moving++;
  focused = current = i;
  const it = items[i];
  try {
    const bmp = await bitmapOf(it);
    if (delay) await wait(delay);
    if (focused !== i) return;
    const old = currentBitmap; currentBitmap = bmp;
    viewer.resetView();                   // chaque image repart de face
    viewer.resetFly();
    // tout le calcul (niveaux, splats, plaque) se fait AVANT d'afficher : l'apparition ne saccade plus
    await showImage(bmp, true, it);        // apparition : les splats se condensent (pas de fondu)
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    showViewer();
    viewerEl.classList.add('on');
    if (old && old !== bmp) old.close();   // libère l'image précédente (mémoire)
  } catch (e) { say('Cette image ne peut pas s’afficher.'); console.error(e); if (focused === i) focused = current = -1; }   // on pourra la rouvrir
  finally { moving--; }
}

/** L'image disparaît en fondu. `swap` : une autre va apparaître à sa place. */
async function leave(_i: number, swap = false) {
  moving++;
  if (!swap) { focused = -1; document.body.classList.remove('viewing'); }
  await viewer.vanish();                 // l'apparition à l'envers
  viewerEl.classList.remove('on');
  await wait(FADE);
  viewer.clear();
  if (!swap && focused < 0) { current = -1; viewerEl.hidden = true; viewer.stop(); }
  moving--;
}

function closeViewer(byScroll = false) {
  if (busy || moving > 0 || focused < 0) return;   // pas pendant qu'une image arrive ou part
  const i = focused;
  leave(i).then(() => {
    if (byScroll) return;                  // sortie à la molette : le disque garde son élan, rien ne le ramène en arrière
    if (vue !== 'disque') (grid.children[i] as HTMLElement | undefined)?.focus({ preventScroll: true });   // disque : il garde sa rotation ×1, rien ne le ramène
  });
}

/** Sens des dégradations de l'image (mesuré une fois par image) : splats, sillons et matière d'or le suivent. */
const axisCache = new Map<string, 'v' | 'h'>();
async function axisOf(it: Item, bmp: ImageBitmap): Promise<'v' | 'h'> {
  let a = axisCache.get(it.id);
  if (!a) { a = detectAxis(await bitmapToRGBA(bmp, 512)); axisCache.set(it.id, a); }
  return a;
}

/** Carte de perte d'une image : mesurée (photo gravée ici) ou estimée depuis ses traces (disque). */
async function lossOf(it: Item, bmp: ImageBitmap): Promise<LossMap> {
  let m = lossCache.get(it.id);
  if (m) return m;
  m = it.kind === 'gravure' && it.g.loss ? it.g.loss : lossFromTraces(await bitmapToRGBA(bmp), await axisOf(it, bmp));
  lossCache.set(it.id, m);
  return m;
}

async function showImage(bmp: ImageBitmap, appear: boolean, it: Item) {
  if (!viewer.ok) { const f = $<HTMLImageElement>('#fallback'); f.hidden = false; f.src = ''; bitmapToBlobUrl(bmp).then((u) => { f.src = u; }); return; }
  let loss: LossMap | null = null;
  try { loss = await lossOf(it, bmp); } catch (e) { console.warn('carte de perte indisponible', e); }
  if (items[current]?.id !== it.id) return;
  const axis = await axisOf(it, bmp);
  if (items[current]?.id !== it.id) return;
  viewer.setImage(bmp, appear, axis, loss, it.id);
}
/** Contraste des images ajoutées, comme celui appliqué aux archives (tools/contraste-originaux.py) :
 *  le gris le plus sombre (0,5 % des points) devient noir, le plus clair (99,5 %) blanc, puis une légère courbe en S. */
function contraste(img: { data: Uint8ClampedArray | Uint8Array; width: number; height: number }) {
  const d = img.data, n = d.length / 4, hist = new Uint32Array(256);
  for (let i = 0; i < d.length; i += 4) hist[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])]++;
  const at = (q: number) => { let s = 0; for (let v = 0; v < 256; v++) { s += hist[v]; if (s >= q * n) return v / 255; } return 1; };
  const lo = at(0.005), hi = at(0.995);
  if (hi - lo < 0.05) return;
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const x = Math.min(1, Math.max(0, (v / 255 - lo) / (hi - lo)));
    lut[v] = Math.round(Math.min(1, Math.max(0, x + 0.35 * (x - 0.5) * (1 - Math.abs(2 * x - 1)))) * 255);
  }
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
}
async function bitmapToBlobUrl(bmp: ImageBitmap) { return URL.createObjectURL(await bitmapToBlob(bmp, 2000, 'image/png')); }

// ─── gravures faites avec une ancienne chaîne : on les refait depuis la photo d'origine ─────
const CHAIN = 3;   // 3 : contraste étendu, comme les archives (les anciennes gravures sont refaites)
async function regrave(g: Gravure): Promise<Gravure> {
  const src = await createImageBitmap(g.source);
  const rgba = await bitmapToRGBA(src);
  const res = await engrave({ ...rgba, data: rgba.data.slice() }, 'barry-2017', isColorful(rgba) ? 'couleur' : 'nb');
  const loss = lossFromDiff(res.scanned, res.decoded); contraste(res.decoded);   // perte mesurée avant, puis les mêmes niveaux étendus que les archives
  const decoded = await createImageBitmap(new ImageData(new Uint8ClampedArray(res.decoded.data), res.decoded.width, res.decoded.height));
  const ng: Gravure = {
    ...g, preset: 'barry-2017', chain: CHAIN, mode: res.passes === 3 ? 'couleur' : 'nb', orientation: res.orientation, passes: res.passes,
    decoded: await rgbaToBlob(res.decoded), thumb: await bitmapToBlob(decoded, 480, 'image/jpeg', 0.85), loss,
  };
  src.close(); decoded.close();   // libère la mémoire des images intermédiaires
  await saveGravure(ng);
  return ng;
}
async function repairOld() {
  const old = items.filter((x): x is Extract<Item, { kind: 'gravure' }> => x.kind === 'gravure' && x.g.chain !== CHAIN);
  for (const it of old) {
    try {
      const ng = await regrave(it.g);
      const k = items.findIndex((x) => x.id === it.id);
      if (k < 0) continue;
      const u = urls.get(it.id + '-t'); if (u) { URL.revokeObjectURL(u); urls.delete(it.id + '-t'); }
      lossCache.delete(it.id); levelById.delete(it.id); axisCache.delete(it.id);
      items[k] = { kind: 'gravure', id: ng.id, g: ng, aspect: ng.orientation ? 364 / 540 : 540 / 364 };
      if (focused < 0) renderGrid();
    } catch (e) { console.warn('gravure non refaite', it.id, e); }
  }
}

// ─── ajouter une photo ────────────────────────────────────────────────────────
/** Un son déposé rejoint les musiques du disque (gardé dans le navigateur) et se joue aussitôt, traité comme les autres. */
async function addSound(file: File) {
  if (busy) return;
  busy = true; document.body.classList.add('busy');
  try {
    if (!(await platine.check(file))) { say('Ce son ne peut pas être lu.'); return; }
    const son = { id: newGravureId().replace('DD-', 'SON-'), date: new Date().toISOString(), titre: file.name.replace(/\.[^.]+$/, ''), blob: file as Blob };
    await saveSon(son);
    platine.addUser(son.id, son.blob, true);
  } catch (e) { console.error(e); say('Le son n’a pas pu être ajouté.'); }
  finally { busy = false; document.body.classList.remove('busy'); }
}
listSons().then((sons) => { for (const s of sons) platine.addUser(s.id, s.blob); });

async function addPhoto(file: File) {
  if (busy) return;
  if (file.type.startsWith('audio/') || /\.(mp3|wav|ogg|oga|opus|m4a|aac|flac|webm)$/i.test(file.name)) { await addSound(file); return; }
  if (!file.type.startsWith('image/')) { say('Choisis une image ou un son.'); return; }
  busy = true; document.body.classList.add('busy');
  try {
    const src = await createImageBitmap(file);
    const rgba = await bitmapToRGBA(src);
    // pendant le traitement, rien ne s'affiche (pas de photo brute) : seul le bouton reste en attente
    const res = await engrave({ ...rgba, data: rgba.data.slice() }, 'barry-2017', isColorful(rgba) ? 'couleur' : 'nb');
    const loss = lossFromDiff(res.scanned, res.decoded); contraste(res.decoded);   // perte mesurée avant, puis les mêmes niveaux étendus que les archives
    const decoded = await createImageBitmap(new ImageData(new Uint8ClampedArray(res.decoded.data), res.decoded.width, res.decoded.height));
    const g: Gravure = {
      id: newGravureId(), date: new Date().toISOString(), titre: file.name.replace(/\.[^.]+$/, ''),
      preset: 'barry-2017', chain: CHAIN, mode: res.passes === 3 ? 'couleur' : 'nb', orientation: res.orientation, passes: res.passes,
      source: await bitmapToBlob(src, 1600), decoded: await rgbaToBlob(res.decoded), thumb: await bitmapToBlob(decoded, 480, 'image/jpeg', 0.85),
      loss,
    };
    src.close();                              // la photo d'origine n'est plus utile en mémoire
    await saveGravure(g);
    platine.engrave();                      // un discret bruit de gravure : l'image est entrée dans le disque
    // disque : la photo s'insère juste hors de l'écran, à droite, et le disque l'amène doucement au centre
    // (rien ne saute) ; galerie : à une place au hasard
    const at = vue === 'disque' && carousel ? (carousel.index + 6) % (items.length + 1) : Math.floor(Math.random() * (items.length + 1));
    items.splice(at, 0, { kind: 'gravure', id: g.id, g, aspect: decoded.width / decoded.height });
    renderGrid();
    if (vue === 'disque') { carousel?.goTo(at); carousel?.flash(at); } else grid.children[at]?.classList.add('new');
    focused = current = at; currentBitmap = decoded;
    // comme à l'ouverture d'une image : tout est calculé avant l'affichage, puis elle se condense
    viewer.resetView(); viewer.resetFly();
    await showImage(decoded, true, items[at]);
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    showViewer(); viewerEl.classList.add('on');
  } catch (e) {
    console.error(e); say('La photo n’a pas pu être traitée.');
    busy = false; viewerEl.classList.remove('on'); document.body.classList.remove('viewing'); viewerEl.hidden = true; viewer.stop(); focused = -1;
  } finally { busy = false; document.body.classList.remove('busy'); }
}

/** Couleur (3 passages R, V, B) si une part notable des pixels est saturée ; sinon noir et blanc. */
function isColorful(img: RGBAImage): boolean {
  let n = 0, sat = 0;
  for (let i = 0; i < img.data.length; i += 4 * 17) {
    const r = img.data[i], g = img.data[i + 1], b = img.data[i + 2];
    if (Math.max(r, g, b) - Math.min(r, g, b) > 28) sat++;
    n++;
  }
  return sat / n > 0.08;
}

let sayTimer = 0;
function say(msg: string) { status.textContent = msg; clearTimeout(sayTimer); sayTimer = window.setTimeout(() => { status.textContent = ''; }, 4000); }

// ─── réglages (temporaires) ───────────────────────────────────────────────────
const setBtn = $('#settings-btn'), setPanel = $('#settings');
// le bouton des réglages n'apparaît qu'avec la touche R (et disparaît avec elle, panneau compris)
window.addEventListener('keydown', (e) => {
  if (e.repeat || e.key.toLowerCase() !== 'r' || e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).closest('input, textarea, select')) return;
  const on = document.body.classList.toggle('reglages');
  if (!on) { setPanel.hidden = true; setBtn.setAttribute('aria-expanded', 'false'); }
});
setBtn.addEventListener('click', () => { setPanel.hidden = !setPanel.hidden; setBtn.setAttribute('aria-expanded', String(!setPanel.hidden)); });
buildSettingsPanel(setPanel, settings, (k) => {
  viewer.look = settings; viewer.autoMotion = settings.motion;
  if ((k === 'step' || k === 'density' || k === 'trichrome' || k === 'matter') && currentBitmap && !viewerEl.hidden) viewer.rebuild(currentBitmap);
});

// ─── évènements ───────────────────────────────────────────────────────────────
// la molette, image ouverte : un mouvement franc la referme (et l'élan passe au disque)
viewerEl.addEventListener('wheel', (e) => {
  if (e.ctrlKey || (e.target as HTMLElement).closest('.settings')) return;
  // défiler fait toujours sortir de la vue de l'image ; le disque reprend sa rotation sans à-coup
  if (focused >= 0 && !busy) {
    e.preventDefault();
    const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
    closeViewer(true); carousel?.calm();   // l'évènement continue jusqu'au disque, qui repart doucement
    void d;
  }
}, { passive: false });
// un clic (sans glisser) loin de l'image ramène à l'accueil
let tap: [number, number] | null = null;
viewerEl.addEventListener('pointerdown', (e) => { tap = [e.clientX, e.clientY]; });
viewerEl.addEventListener('pointerup', (e) => {
  if (!tap || (e.target as HTMLElement).closest('button, .settings')) { tap = null; return; }
  const moved = Math.hypot(e.clientX - tap[0], e.clientY - tap[1]); tap = null;
  const b = Viewer.rectFor(items[focused]?.aspect ?? 1.5), m = 24;
  const outside = e.clientX < b.left - m || e.clientX > b.left + b.width + m || e.clientY < b.top - m || e.clientY > b.top + b.height + m;
  if (moved < 5 && outside) closeViewer();
});
window.addEventListener('keydown', (e) => {
  if ((e.target as HTMLElement).closest('input,select')) return;
  if (document.body.classList.contains('welcome')) return;   // l'accueil a ses propres touches
  if (viewerEl.hidden) {
    if (vue !== 'disque' || !carousel) return;
    if (e.key === 'ArrowRight') { e.preventDefault(); carousel.step(1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); carousel.step(-1); }
    else if (e.key === 'Enter' && !(e.target as HTMLElement).closest('button,a')) open(carousel.index);
    return;
  }
  if (e.key === 'Escape') closeViewer();
  else if (e.key === 'ArrowRight' && focused >= 0) open(focused + 1, true);
  else if (e.key === 'ArrowLeft' && focused >= 0) open(focused - 1, true);
});
const file = $<HTMLInputElement>('#file');
file.addEventListener('change', () => { if (file.files?.[0]) { dropUntil = 0; addPhoto(file.files[0]); } file.value = ''; });
// glisser-déposer : seulement après un clic sur « Ajouter une photo » (pendant 60 s, ou jusqu'au dépôt)
let depth = 0, dropUntil = 0;
const dropOk = () => performance.now() < dropUntil;
document.querySelector('.add')?.addEventListener('click', () => { dropUntil = performance.now() + 60000; });
file.addEventListener('cancel', () => { /* le sélecteur fermé : on peut encore déposer pendant le délai */ });
window.addEventListener('dragenter', (e) => { if (dropOk() && e.dataTransfer?.types.includes('Files')) { depth++; document.body.classList.add('dragging'); } });
window.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) document.body.classList.remove('dragging'); });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => { e.preventDefault(); depth = 0; document.body.classList.remove('dragging'); if (!dropOk()) return; dropUntil = 0; const f = e.dataTransfer?.files?.[0]; if (f) addPhoto(f); });

// ─── démarrage ────────────────────────────────────────────────────────────────
paintSpace(); twinkle();
spinNear($('.brand .disc'));
refletIcones('.vue-btn, .settings-btn');   // même reflet doré que le titre, sur les icônes
if (!new URLSearchParams(location.search).has('image') && !new URLSearchParams(location.search).has('entrer')) { vue = 'disque'; carouselArrive = true; prelude().then(() => welcome()).then(() => carousel?.arrive(lastSpin)); }   // pré-accueil → accueil → disque   // l'accueil mène à l'interface du disque
else { document.body.classList.remove('welcome'); platine.play('musiques'); }   // (la page démarre masquée : rien ne s'affiche avant l'accueil)
(async () => {
  try {
    const [archives, gravures, aspects] = await Promise.all([loadArchives(), listGravures(),
      fetch('/thumbs/aspects.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})) as Promise<Record<string, number>>]);   // format réel (images recadrées)
    items = [
      ...(await Promise.all(gravures.reverse().map(async (g) => {
        const t = await trimmedThumb(g);
        if (t) urls.set(g.id + '-t', t.url);
        return { kind: 'gravure' as const, id: g.id, g, aspect: t?.aspect ?? (g.orientation ? 364 / 540 : 540 / 364) };
      }))),
      ...archives.sort((a, b) => a.position - b.position).map((a) => ({ kind: 'archive' as const, id: a.id, a, aspect: aspects[a.id] ?? (a.orientation ? 364 / 540 : 540 / 364) })),
    ];
    for (let k = items.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [items[k], items[j]] = [items[j], items[k]]; }   // ordre au hasard
    setVue(vue);
    repairOld();                           // les photos ajoutées avec l'ancienne chaîne sont retraitées
    const q = new URLSearchParams(location.search).get('image');
    if (q) { const i = items.findIndex((x) => x.id === q); if (i >= 0) open(i); }
  } catch (e) { console.error(e); say('La collection n’a pas pu se charger.'); }
})();
