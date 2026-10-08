/**
 * Page /calibration : les paires NASA ↔ Barry, côte à côte, avec les réglages de la chaîne.
 */
import type { RGBAImage } from '../chain/types.ts';
import type { ChainParams } from '../chain/params.ts';
import type { Request, Response, CalibrateResult } from '../worker/protocol.ts';
import type { PairInfo, ArchiveImage } from './pairs.ts';
import { DEFAULT_KNOBS, getAt, setAt } from './search.ts';
import { PRESETS, DEFAULT_PRESET } from '../presets.ts';

// ─── réglages exposés ─────────────────────────────────────────────────────────
interface Control { path: string; label: string; min: number; max: number; step: number; log?: boolean; hint?: string; fmt?: (v: number) => string }
interface Group { title: string; toggle?: string; controls: Control[] }

const hz = (v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)} kHz` : `${v.toFixed(v < 10 ? 1 : 0)} Hz`;
const GROUPS: Group[] = [
  { title: 'A · Encodage', controls: [
    { path: 'encode.gamma', label: 'Courbe (gamma)', min: 0.3, max: 2.5, step: 0.01, hint: 'luminance → tension' },
    { path: 'encode.white', label: 'Niveau du blanc', min: -0.3, max: 0, step: 0.001 },
    { path: 'encode.black', label: 'Niveau du noir', min: 0, max: 0.3, step: 0.001 },
  ] },
  { title: 'B · Couplage AC (passe-haut)', toggle: 'channel.highpass.enabled', controls: [
    { path: 'channel.highpass.cutoffHz', label: 'Coupure', min: 1, max: 800, step: 0.01, log: true, fmt: hz, hint: 'ombres, anti-ombres, dégradé haut → bas' },
  ] },
  { title: 'B · Bande passante (passe-bas)', toggle: 'channel.lowpass.enabled', controls: [
    { path: 'channel.lowpass.cutoffHz', label: 'Coupure', min: 2000, max: 180000, step: 0.01, log: true, fmt: hz },
  ] },
  { title: 'B · Bruit de fond', toggle: 'channel.noise.enabled', controls: [
    { path: 'channel.noise.rms', label: 'Niveau (RMS)', min: 0, max: 0.05, step: 0.0005 },
  ] },
  { title: 'B · Pleurage / scintillement', toggle: 'channel.wowFlutter.enabled', controls: [
    { path: 'channel.wowFlutter.wowDepth', label: 'Pleurage', min: 0, max: 40, step: 0.5, hint: 'en échantillons' },
    { path: 'channel.wowFlutter.flutterDepth', label: 'Scintillement', min: 0, max: 20, step: 0.1 },
    { path: 'channel.wowFlutter.flutterRateHz', label: 'Fréquence du scintillement', min: 1, max: 60, step: 0.5, fmt: hz },
  ] },
  { title: 'B · Une trace sur deux', toggle: 'channel.evenOdd.enabled', controls: [
    { path: 'channel.evenOdd.samples', label: 'Décalage', min: -40, max: 40, step: 1, hint: 'en échantillons (Barry corrige 12)' },
  ] },
  { title: 'C · Décodage (méthode Barry)', controls: [
    { path: 'decode.lower', label: 'Borne basse', min: -0.5, max: 0, step: 0.005 },
    { path: 'decode.upper', label: 'Borne haute', min: 0, max: 0.5, step: 0.005 },
    { path: 'decode.evenCorrection', label: 'Correction traces paires', min: -30, max: 30, step: 1 },
  ] },
];

// ─── état ─────────────────────────────────────────────────────────────────────
let params: ChainParams = structuredClone(PRESETS[DEFAULT_PRESET]);
let archives: ArchiveImage[] = [];
let pairs: PairInfo[] = [];
const results = new Map<string, CalibrateResult>();

const worker = new Worker(new URL('../worker/chain.worker.ts', import.meta.url), { type: 'module' });
let pending: ((r: Response) => boolean)[] = [];
worker.onmessage = (ev: MessageEvent<Response>) => {
  if (ev.data.type === 'error') console.error('[chaîne]', ev.data.message);
  pending = pending.filter((h) => !h(ev.data));
};
function ask<T extends Response>(req: Request, match: (r: Response) => r is T, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    pending.push((r) => { if (r.type === 'error') { reject(new Error(r.message)); return true; } if (match(r)) { resolve(r); return true; } return false; });
    worker.postMessage(req, transfer);
  });
}

async function loadRGBA(url: string): Promise<RGBAImage> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  const c = new OffscreenCanvas(bmp.width, bmp.height);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  const d = g.getImageData(0, 0, bmp.width, bmp.height);
  return { width: d.width, height: d.height, data: d.data };
}

function paint(canvas: HTMLCanvasElement, img: RGBAImage) {
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
}

// ─── panneau de réglages ──────────────────────────────────────────────────────
const panel = document.getElementById('panel')!;
const logEl = document.createElement('div');
const inputs: { c: Control; input: HTMLInputElement; out: HTMLOutputElement }[] = [];
const toggles: { path: string; input: HTMLInputElement; box: HTMLElement }[] = [];

const toSlider = (c: Control, v: number) => c.log ? Math.log(v) : v;
const fromSlider = (c: Control, s: number) => c.log ? Math.exp(s) : s;
const show = (c: Control, v: number) => c.fmt ? c.fmt(v) : (Math.abs(v) < 1 ? v.toFixed(3) : v.toFixed(2));

function buildPanel() {
  panel.innerHTML = '';
  const h = document.createElement('h2'); h.textContent = 'Preset'; panel.append(h);
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', 'Preset');
  for (const [k, p] of Object.entries(PRESETS)) sel.append(new Option(p.name, k, false, p.name === params.name));
  const desc = document.createElement('p'); desc.className = 'preset-desc'; desc.textContent = params.description;
  sel.onchange = () => { params = structuredClone(PRESETS[sel.value]); syncPanel(); desc.textContent = params.description; recompute(); };
  panel.append(sel, desc);

  for (const g of GROUPS) {
    const box = document.createElement('div'); box.className = 'group';
    if (g.toggle) {
      const lab = document.createElement('label'); lab.className = 'toggle';
      const cb = document.createElement('input'); cb.type = 'checkbox';
      cb.onchange = () => { setAt(params, g.toggle!, cb.checked as unknown as number); box.classList.toggle('off', !cb.checked); scheduleRecompute(); };
      lab.append(cb, document.createTextNode(g.title));
      box.append(lab); toggles.push({ path: g.toggle, input: cb, box });
    } else {
      const t = document.createElement('h2'); t.textContent = g.title; box.append(t);
    }
    for (const c of g.controls) {
      const f = document.createElement('div'); f.className = 'field';
      const id = 'k-' + c.path.replace(/\./g, '-');
      const lab = document.createElement('label'); lab.htmlFor = id; lab.textContent = c.label;
      const out = document.createElement('output'); out.htmlFor = id;
      const input = document.createElement('input'); input.type = 'range'; input.id = id;
      input.min = String(toSlider(c, c.min)); input.max = String(toSlider(c, c.max)); input.step = String(c.step);
      input.oninput = () => { const v = fromSlider(c, Number(input.value)); setAt(params, c.path, v); out.textContent = show(c, v); scheduleRecompute(); };
      f.append(lab, out, input);
      if (c.hint) { const hEl = document.createElement('span'); hEl.className = 'hint'; hEl.textContent = c.hint; f.append(hEl); }
      box.append(f); inputs.push({ c, input, out });
    }
    panel.append(box);
  }

  const actions = document.createElement('div'); actions.className = 'actions';
  const opt = document.createElement('button'); opt.className = 'primary'; opt.textContent = 'Optimiser automatiquement';
  opt.title = 'Descente par coordonnées sur un tiers des paires (quelques minutes)';
  opt.onclick = () => optimize(opt);
  const exp = document.createElement('button'); exp.textContent = 'Exporter le preset (JSON)';
  exp.onclick = () => {
    const blob = new Blob([JSON.stringify(params, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'preset-calibre.json'; a.click();
  };
  actions.append(opt, exp);
  logEl.className = 'log';
  panel.append(actions, logEl);
  syncPanel();
}

function syncPanel() {
  for (const { c, input, out } of inputs) { const v = getAt(params, c.path); input.value = String(toSlider(c, v)); out.textContent = show(c, v); }
  for (const t of toggles) { const on = Boolean(getAt(params, t.path)); t.input.checked = on; t.box.classList.toggle('off', !on); }
}

// ─── paires ───────────────────────────────────────────────────────────────────
const pairsEl = document.getElementById('pairs')!;
const summaryEl = document.getElementById('summary')!;
const cards = new Map<string, { el: HTMLElement; canvases: HTMLCanvasElement[]; scores: HTMLElement }>();

function buildCards() {
  for (const p of pairs) {
    const a = archives.find((x) => x.id === p.id)!;
    const el = document.createElement('article'); el.className = 'pair pending';
    const head = document.createElement('header');
    head.innerHTML = `<span class="id">${a.id}</span><span class="title">${a.titre_en}</span>
      <span class="meta">position ${a.position} · piste ${a.piste} · ${a.type === 'couleur' ? 'couleur (3 passages)' : 'N&B'}</span>`;
    const scores = document.createElement('span'); scores.className = 'scores'; head.append(scores);
    const strip = document.createElement('div'); strip.className = 'strip' + (p.orientation ? ' portrait' : '');
    const labels = ['NASA · envoyé', 'Simulation', 'Barry 2017 · décodé', 'Écart'];
    const canvases = labels.map((l, i) => {
      const fig = document.createElement('figure'); const cv = document.createElement('canvas');
      cv.width = p.orientation ? 364 : 540; cv.height = p.orientation ? 540 : 364;
      cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', `${a.titre_en} — ${l}`);
      const cap = document.createElement('figcaption'); cap.textContent = l; if (i === 1) cap.className = 'gold';
      fig.append(cv, cap); strip.append(fig); return cv;
    });
    const credit = document.createElement('p'); credit.className = 'credit';
    credit.innerHTML = a.credit
      ? `Crédit : ${a.credit}`
      : `Crédit : <span class="verif">à vérifier</span>${a.credit_indice_wikipedia ? ` (indice Wikipédia : ${a.credit_indice_wikipedia})` : ''} · <a href="${a.source}" target="_blank" rel="noopener">source</a>`;
    el.append(head, strip, credit);
    pairsEl.append(el);
    cards.set(p.id, { el, canvases, scores });
  }
}

let generation = 0;
async function recompute() {
  const gen = ++generation;
  for (const p of pairs) {
    if (gen !== generation) return;
    const r = await ask({ type: 'calibrate', id: p.id, params }, (x): x is CalibrateResult => x.type === 'calibrated' && x.id === p.id);
    if (gen !== generation) return;
    results.set(p.id, r);
    const card = cards.get(p.id)!;
    [r.input, r.sim, r.ref, r.diff].forEach((img, i) => paint(card.canvases[i], img));
    card.el.classList.remove('pending');
    card.scores.innerHTML = `écart <b>${r.scores.mae.toFixed(3)}</b> · SSIM <b>${r.scores.ssim.toFixed(3)}</b> · bords <b>${r.scores.grad.toFixed(3)}</b>` + (r.scores.color !== undefined ? ` · couleur <b>${r.scores.color.toFixed(3)}</b>` : '');
    renderSummary();
  }
}
let timer = 0;
function scheduleRecompute() { clearTimeout(timer); timer = window.setTimeout(recompute, 250); }

function renderSummary() {
  const rs = pairs.map((p) => results.get(p.id)).filter(Boolean) as CalibrateResult[];
  const m = (k: 'mae' | 'ssim' | 'grad') => rs.reduce((s, r) => s + r.scores[k], 0) / Math.max(rs.length, 1);
  const ms = rs.reduce((s, r) => s + r.ms, 0) / Math.max(rs.length, 1);
  summaryEl.innerHTML = `
    <div class="stat"><b>${m('mae').toFixed(3)}</b><span>écart moyen</span></div>
    <div class="stat"><b>${m('ssim').toFixed(3)}</b><span>SSIM moyen</span></div>
    <div class="stat"><b>${m('grad').toFixed(3)}</b><span>corrélation des bords</span></div>
    ${(() => { const c = rs.filter((r) => r.scores.color !== undefined); return c.length ? `<div class="stat"><b>${(c.reduce((s, r) => s + r.scores.color!, 0) / c.length).toFixed(3)}</b><span>écart couleur (${c.length} paires)</span></div>` : ''; })()}
    <div class="stat"><b>${rs.length}/${pairs.length}</b><span>paires calculées</span></div>
    <div class="stat"><b>${ms.toFixed(0)}</b><span>ms par image</span></div>
    <p class="note">Écart mesuré dans la zone où l'image NASA a été recalée. 2 paires exclues : GR-008 (spectre solaire, presque sans bords) et GR-009 (Mercure, recadrage NASA différent de la gravure).</p>`;
}

async function optimize(btn: HTMLButtonElement) {
  btn.disabled = true; logEl.textContent = 'Recherche en cours…\n';
  generation++;
  const done = ask({ type: 'optimize', params, knobs: DEFAULT_KNOBS, rounds: 3, subset: 3 },
    (r): r is Extract<Response, { type: 'optimized' }> => {
      if (r.type === 'progress') logEl.textContent += `${r.step.path.split('.').slice(-2).join('.')} = ${r.step.value.toFixed(4)} → ${r.step.score.toFixed(4)}\n`;
      return r.type === 'optimized';
    });
  const r = await done;
  params = r.params; params.name = 'Calibré (session)';
  syncPanel(); btn.disabled = false; logEl.textContent += `Terminé : score ${r.score.toFixed(4)}\n`;
  recompute();
}

// ─── démarrage ────────────────────────────────────────────────────────────────
async function main() {
  const [a, p] = await Promise.all([
    fetch('/data/archives.json').then((r) => r.json()),
    fetch('/data/calibration-pairs.json').then((r) => r.json()),
  ]);
  archives = a.images;
  pairs = (p.paires as PairInfo[]).filter((x) => !x.exclue);
  buildPanel();
  buildCards();
  summaryEl.textContent = 'Chargement des images…';
  for (const pair of pairs) {
    const arc = archives.find((x) => x.id === pair.id)!;
    const [nasa, barry] = await Promise.all([loadRGBA('/' + arc.fichier_nasa), loadRGBA('/' + arc.fichier_decode)]);
    await ask({ type: 'load-pair', pair, kind: arc.type, nasa, barry }, (r): r is Extract<Response, { type: 'loaded' }> => r.type === 'loaded' && r.id === pair.id,
      [nasa.data.buffer as ArrayBuffer, barry.data.buffer as ArrayBuffer]);
  }
  recompute();
}
main().catch((e) => { summaryEl.textContent = 'Erreur : ' + e.message; console.error(e); });
