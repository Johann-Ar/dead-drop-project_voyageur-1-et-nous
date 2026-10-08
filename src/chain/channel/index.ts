/**
 * B — Le canal : tout ce qui abîme le signal entre la machine de 1977 et la lecture de 2017.
 * Ordre physique : défauts liés à la trame (alternance, décalage R/V/B) → couplage AC →
 * bande passante → vitesse de lecture → bruit.
 */
import type { Signal } from '../types.ts';
import type { ChannelParams, EncodeParams } from '../params.ts';
import { highpass } from './highpass.ts';
import { lowpass } from './lowpass.ts';
import { addNoise } from './noise.ts';
import { wowFlutter } from './wowflutter.ts';
import { shiftTraceContent } from './shiftContent.ts';

export function applyChannel(sig: Signal, c: ChannelParams, e: EncodeParams): Signal {
  let y: Float32Array = sig.samples.slice();
  const perPixel = (e.windowEnd - e.windowStart) / e.pixels;
  const passes = sig.passStarts.length;
  const content = (m: number) => [m + e.sync.recovery + 1, m + Math.round(e.period) - e.sync.length - 16] as const;

  if (c.evenOdd.enabled || c.rgbShift.enabled) {
    const shifts = [c.rgbShift.r, c.rgbShift.g, c.rgbShift.b];
    for (let pass = 0; pass < passes; pass++) {
      const rgb = c.rgbShift.enabled && passes === 3 ? shifts[pass] * perPixel : 0;
      for (let k = 0; k < sig.traces; k++) {
        const eo = c.evenOdd.enabled && k % 2 === 0 ? c.evenOdd.samples : 0;
        const [a, b] = content(sig.traceMarks[pass * sig.traces + k]);
        shiftTraceContent(y, a, b, rgb + eo);
      }
    }
  }
  if (c.highpass.enabled) y = highpass(y, sig.sampleRate, c.highpass.cutoffHz);
  if (c.lowpass.enabled) y = lowpass(y, sig.sampleRate, c.lowpass.cutoffHz, c.lowpass.order);
  if (c.wowFlutter.enabled) y = wowFlutter(y, sig.sampleRate, c.wowFlutter);
  if (c.noise.enabled) y = addNoise(y, c.noise.rms, c.noise.seed, c.noise.lowRms ?? 0, c.noise.lowCutoffHz ?? 150, sig.sampleRate);
  return { ...sig, samples: y };
}
