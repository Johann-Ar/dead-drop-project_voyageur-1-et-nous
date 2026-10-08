/**
 * Paramètres de la chaîne. Chaque preset (presets/*.json) est un objet ChainParams complet.
 *
 * Les valeurs par défaut viennent de deux sources, signalées en commentaire :
 * - [mesure]  data/signal-reference.json, mesuré sur le vrai signal (tools/analyse-signal.py) ;
 * - [Barry]   valeurs décrites ou utilisées par Ron Barry (2017) pour son décodage ;
 * - [calib]   à régler par la calibration (étape 3).
 */
import type { Toggle } from './types.ts';

export interface SyncShape {
  /** durée de l'impulsion avant le creux, en échantillons [mesure ≈ 150] */
  length: number;
  /** niveau du plateau [mesure ≈ 0,084] */
  level: number;
  /** pic au début du plateau [mesure ≈ 0,139] */
  leadSpike: number;
  /** bosse juste avant le front descendant [mesure ≈ 0,11] */
  tailBump: number;
  /** creux du front descendant — le repère du décodeur [mesure ≈ −0,115] */
  dip: number;
  /** retour au niveau de repos après le creux, en échantillons */
  recovery: number;
}

export interface EncodeParams {
  sampleRate: number;
  /** traces par trame [Barry 540] */
  traces: number;
  /** pixels par trace [Barry 364] */
  pixels: number;
  /** période moyenne d'une trace, en échantillons [mesure 3195 ≈ 8,32 ms] */
  period: number;
  /** écart entre traces paires et impaires (périodes alternées) [mesure ≈ 12,5] */
  alternation: number;
  /** fenêtre de l'image après le creux de synchro, en échantillons [Barry 220 → 2900] */
  windowStart: number;
  windowEnd: number;
  /** niveau du signal pour le blanc et le noir (le blanc est négatif) [mesure p0,5 / p99,5] */
  white: number;
  black: number;
  /** niveau de repos hors image */
  porch: number;
  /** courbe luminance → tension (1 = linéaire) [calib] */
  gamma: number;
  sync: SyncShape;
  /** traces vides avant la première trace (le décodeur a besoin d'une synchro de départ) */
  leadInTraces: number;
}

export interface ChannelParams {
  /** couplage AC : l'hypothèse la plus probable pour les ombres / anti-ombres et le dégradé haut→bas [calib] */
  highpass: Toggle & { cutoffHz: number };
  /** bande passante limitée [calib] */
  lowpass: Toggle & { cutoffHz: number; order: 1 | 2 };
  /** bruit de fond : blanc (rms) + basse fréquence (lowRms, sous lowCutoffHz) → stries verticales [calib] */
  noise: Toggle & { rms: number; lowRms: number; lowCutoffHz: number; seed: number };
  /** variations de vitesse → tremblement des traces. Profondeurs en échantillons. */
  wowFlutter: Toggle & {
    wowDepth: number; wowRateHz: number;
    flutterDepth: number; flutterRateHz: number;
    driftDepth: number; seed: number;
  };
  /** une trace sur deux décalée par rapport à sa synchro (Barry : 3100 / 3300) — en échantillons */
  evenOdd: Toggle & { samples: number };
  /** décalage vertical entre passages R, V, B → franges de couleur — en pixels */
  rgbShift: Toggle & { r: number; g: number; b: number };
}

export interface DecodeParams {
  /** fenêtre de recherche du pic de synchro puis du creux [Barry 190] */
  searchWindow: number;
  /** écart minimal entre deux traces [Barry 3000] */
  minPeriod: number;
  traces: number;
  pixels: number;
  windowStart: number;
  windowEnd: number;
  /** correction des traces paires, en échantillons [Barry 12] */
  evenCorrection: number;
  /** bornes de la courbe d'intensité [Barry −0,26 / 0,18] */
  lower: number;
  upper: number;
  curve: 'cosine' | 'linear';
  /** les images de Barry sortaient en négatif : l'inversion est intégrée à la courbe */
  invert: boolean;
}

export interface ChainParams {
  name: string;
  description: string;
  encode: EncodeParams;
  channel: ChannelParams;
  decode: DecodeParams;
}

export const SAMPLE_RATE = 384000;

export function defaultEncode(): EncodeParams {
  return {
    sampleRate: SAMPLE_RATE,
    traces: 540,
    pixels: 364,
    period: 3195,
    alternation: 12.5,
    windowStart: 220,
    windowEnd: 2900,
    white: -0.112,
    black: 0.077,
    porch: -0.02,
    gamma: 1,
    sync: { length: 150, level: 0.084, leadSpike: 0.139, tailBump: 0.11, dip: -0.115, recovery: 20 },
    leadInTraces: 1,
  };
}

export function cleanChannel(): ChannelParams {
  return {
    highpass: { enabled: false, cutoffHz: 20 },
    lowpass: { enabled: false, cutoffHz: 60000, order: 2 },
    noise: { enabled: false, rms: 0.004, lowRms: 0, lowCutoffHz: 150, seed: 1977 },
    wowFlutter: { enabled: false, wowDepth: 2, wowRateHz: 0.55, flutterDepth: 0.6, flutterRateHz: 11, driftDepth: 1, seed: 1977 },
    evenOdd: { enabled: false, samples: 12 },
    rgbShift: { enabled: false, r: 0, g: 0, b: 0 },
  };
}

export function defaultDecode(): DecodeParams {
  return {
    searchWindow: 190,
    minPeriod: 3000,
    traces: 540,
    pixels: 364,
    windowStart: 220,
    windowEnd: 2900,
    evenCorrection: 0,
    lower: -0.26,
    upper: 0.18,
    curve: 'cosine',
    invert: true,
  };
}

/** Copie profonde (les presets sont des objets JSON simples). */
export function cloneParams(p: ChainParams): ChainParams {
  return structuredClone(p);
}
