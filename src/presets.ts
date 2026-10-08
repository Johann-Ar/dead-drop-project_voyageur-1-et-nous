/** Les presets de la chaîne (objets JSON complets). */
import type { ChainParams } from './chain/params.ts';
import barry from '../presets/barry-2017.json';
import propre from '../presets/signal-propre.json';
import longue from '../presets/longue-distance.json';
import depart from '../presets/depart-calibration.json';

export const PRESETS: Record<string, ChainParams> = {
  'barry-2017': barry as ChainParams,
  'signal-propre': propre as ChainParams,
  'longue-distance': longue as ChainParams,
  'depart-calibration': depart as ChainParams,
};
export const DEFAULT_PRESET = 'barry-2017';
