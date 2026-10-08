/**
 * Export WAV — « le son de ton image ».
 * - fidèle : 384 kHz, float 32 bits, mono (le signal tel que simulé) ;
 * - écoute : 48 kHz, 16 bits, après filtrage anti-repliement (ce qu'une oreille peut entendre).
 */
import { lowpass } from './channel/lowpass.ts';

export function encodeWav(samples: Float32Array, sampleRate: number, format: 'float32' | 'pcm16'): ArrayBuffer {
  const bps = format === 'float32' ? 4 : 2;
  const dataLen = samples.length * bps;
  const buf = new ArrayBuffer(44 + dataLen);
  const v = new DataView(buf);
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataLen, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true);
  v.setUint16(20, format === 'float32' ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  v.setUint16(22, 1, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * bps, true); v.setUint16(32, bps, true); v.setUint16(34, bps * 8, true);
  str(36, 'data'); v.setUint32(40, dataLen, true);
  let o = 44;
  if (format === 'float32') for (let i = 0; i < samples.length; i++, o += 4) v.setFloat32(o, samples[i], true);
  else for (let i = 0; i < samples.length; i++, o += 2) v.setInt16(o, Math.max(-1, Math.min(1, samples[i])) * 32767, true);
  return buf;
}

/** Version audible : passe-bas à 20 kHz puis décimation par un facteur entier. */
export function toListening(samples: Float32Array, sampleRate: number, target = 48000): { samples: Float32Array; sampleRate: number } {
  const factor = Math.max(1, Math.round(sampleRate / target));
  const f = lowpass(lowpass(samples, sampleRate, 20000, 2), sampleRate, 20000, 2);
  const out = new Float32Array(Math.floor(f.length / factor));
  let peak = 1e-9;
  for (let i = 0; i < out.length; i++) { out[i] = f[i * factor]; peak = Math.max(peak, Math.abs(out[i])); }
  const g = 0.9 / peak;
  for (let i = 0; i < out.length; i++) out[i] *= g;
  return { samples: out, sampleRate: sampleRate / factor };
}
