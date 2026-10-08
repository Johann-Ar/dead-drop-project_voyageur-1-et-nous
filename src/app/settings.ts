/**
 * Réglages de rendu — TEMPORAIRES, pour tester les rendus rapidement.
 * Une fois le bon rendu choisi, on le fige en un seul préréglage et ce tiroir disparaît.
 */
import { DEFAULT_LOOK, type SplatLook } from '../scene/splats.ts';

export interface Settings extends SplatLook {
  preset: string;        // rendu appliqué aux photos ajoutées
  motion: boolean;       // oscillation lente de l'image
}

const KEY = 'deaddrop-reglages-2';
/** Préréglage retenu (01/10/2026) : relief par les gris, fin et net, étiré le long des traces. */
export const DEFAULTS: Settings = {
  ...DEFAULT_LOOK, native: 0, aniso: 3.9, drift: 2, size: 2.5, soft: 7.9, jitter: 0, height: 0.25, breath: 0.3, step: 1,
  trichrome: false, preset: 'barry-2017', motion: true,
};

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}');
    // anciens réglages : case « Matière » (oui/non) et « Densité (1 = max) »
    if (typeof raw.matter === 'boolean') raw.matter = raw.matter ? 1 : 0;
    if (raw.density === undefined && typeof raw.step === 'number') raw.density = -2 * Math.log2(Math.max(1, raw.step));
    return { ...DEFAULTS, ...raw };
  } catch { return { ...DEFAULTS }; }
}
export function saveSettings(s: Settings) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* stockage indisponible */ } }

interface Range { key: Exclude<keyof SplatLook, 'trichrome' | 'render' | 'forme'>; label: string; min: number; max: number; step: number }
const RANGES: Range[] = [
  { key: 'gold', label: 'Or du disque (0 : gris, au-delà de 1 : plus intense)', min: 0, max: 2, step: 0.05 },
  { key: 'native', label: 'Gris → perte du signal', min: 0, max: 1, step: 0.05 },
  { key: 'aniso', label: 'Étirement le long des traces', min: 1, max: 5, step: 0.1 },
  { key: 'drift', label: 'Dérive des parties abîmées', min: 0, max: 2, step: 0.05 },
  { key: 'size', label: 'Taille des splats', min: 0.8, max: 6, step: 0.1 },
  { key: 'soft', label: 'Netteté', min: 0.8, max: 9, step: 0.1 },
  { key: 'jitter', label: 'Désordre', min: 0, max: 2, step: 0.05 },
  { key: 'height', label: 'Détachement / relief', min: 0, max: 2.5, step: 0.05 },
  { key: 'breath', label: 'Flottement', min: 0, max: 1, step: 0.05 },
  { key: 'plaque', label: 'Épaisseur du tirage', min: 0.005, max: 0.3, step: 0.005 },
  { key: 'density', label: 'Densité des splats (− moins · + plus)', min: -3, max: 1.5, step: 0.25 },
  { key: 'matter', label: 'Matière : l’image devient une plaque gravée', min: 0, max: 1, step: 0.05 },
];

/** Construit le tiroir. `onChange(clé)` est appelé à chaque modification. */
export function buildSettingsPanel(el: HTMLElement, s: Settings, onChange: (k: keyof Settings) => void) {
  const row = (html: string) => { const d = document.createElement('div'); d.className = 'set-row'; d.innerHTML = html; el.append(d); return d; };
  el.innerHTML = '<h2>Réglages de rendu <span>temporaire</span></h2>';
  const modes: [string, string][] = [['mixte', 'Splats + plaque (Matière)'], ['splats', 'Splats seuls'], ['plaque', 'Plaque gravée (métal)'], ['lisse', 'Relief lisse (sans sillons)'], ['lignes', 'Lignes gravées']];
  const rr = row(`<label>Rendu de l'image en volume<select>${modes.map(([k, l]) => `<option value="${k}" ${(s.render ?? 'mixte') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`);
  rr.querySelector('select')!.addEventListener('change', (e) => { s.render = (e.target as HTMLSelectElement).value as Settings['render']; saveSettings(s); onChange('render'); });
  const formes: [string, string][] = [['points', 'Points'], ['fins', 'Traits fins'], ['longs', 'Traits longs'], ['hachures', 'Hachures croisées'], ['libres', 'Traits libres']];
  const rf = row(`<label>Forme des splats<select>${formes.map(([k, l]) => `<option value="${k}" ${(s.forme ?? 'points') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`);
  rf.querySelector('select')!.addEventListener('change', (e) => { s.forme = (e.target as HTMLSelectElement).value as Settings['forme']; saveSettings(s); onChange('forme'); });
  for (const r of RANGES) {
    const d = row(`<label>${r.label} <output>${s[r.key]}</output><input type="range" min="${r.min}" max="${r.max}" step="${r.step}" value="${s[r.key]}"></label>`);
    const input = d.querySelector('input')!, out = d.querySelector('output')!;
    input.addEventListener('input', () => { s[r.key] = Number(input.value); out.textContent = input.value; saveSettings(s); onChange(r.key); });
  }
  const ck = (key: 'motion', label: string) => {
    const d = row(`<label class="ck"><input type="checkbox" ${s[key] ? 'checked' : ''}> ${label}</label>`);
    d.querySelector('input')!.addEventListener('change', (e) => { s[key] = (e.target as HTMLInputElement).checked; saveSettings(s); onChange(key); });
  };
  ck('motion', 'Oscillation lente');
  const act = row('<button type="button" data-reset>Valeurs par défaut</button> <a href="/calibration.html">Calibration</a>');
  act.querySelector('[data-reset]')!.addEventListener('click', () => { Object.assign(s, DEFAULTS); saveSettings(s); buildSettingsPanel(el, s, onChange); onChange('density'); });
}
