/** Messages échangés entre l'interface et le Web Worker de la chaîne. */
import type { RGBAImage } from '../chain/types.ts';
import type { ChainParams } from '../chain/params.ts';
import type { Scores } from '../calibration/metrics.ts';
import type { PairInfo } from '../calibration/pairs.ts';
import type { Knob, SearchLog } from '../calibration/search.ts';

export type Request =
  | { type: 'load-pair'; pair: PairInfo; kind: 'nb' | 'couleur'; nasa: RGBAImage; barry: RGBAImage }
  | { type: 'calibrate'; id: string; params: ChainParams }
  | { type: 'score-all'; params: ChainParams }
  | { type: 'optimize'; params: ChainParams; knobs: Knob[]; rounds: number; subset: number }
  | { type: 'engrave'; job: number; image: RGBAImage; params: ChainParams; mode: 'nb' | 'couleur'; orientation: 0 | 1 | 2 | 'auto'; fidele?: boolean; leger?: boolean };   // leger : pas de séparations ni de bloc (inutiles à l'interface)

export interface EngraveResult {
  type: 'engraved';
  job: number;
  orientation: 0 | 1 | 2;
  passes: number;
  /** la trame préparée (ce que voit la caméra), orientation d'affichage */
  scanned: RGBAImage;
  /** l'image décodée, orientation d'affichage */
  decoded: RGBAImage;
  /** séparations R, V, B décodées (images couleur seulement) */
  separations: RGBAImage[];
  /** bloc [passage][trace][400] */
  block: Float32Array;
  /** signal complet à 384 kHz (seulement si fidele = true, pour l'export WAV) */
  signal384?: Float32Array;
  ms: number;
}

export interface CalibrateResult {
  type: 'calibrated';
  id: string;
  input: RGBAImage;
  sim: RGBAImage;
  ref: RGBAImage;
  diff: RGBAImage;
  scores: Scores;
  ms: number;
}

export type Response =
  | { type: 'loaded'; id: string }
  | CalibrateResult
  | { type: 'scores'; per: (Scores & { id: string })[]; mean: Scores; objective: number }
  | { type: 'progress'; step: SearchLog; evaluations: number }
  | { type: 'optimized'; params: ChainParams; score: number; log: SearchLog[] }
  | EngraveResult
  | { type: 'stage'; job: number; stage: 'scan' | 'encode' | 'channel' | 'decode' }
  | { type: 'error'; message: string; job?: number };
