import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultEncode, defaultDecode, cleanChannel, type ChainParams } from '../src/chain/params.ts';
import { encodeFrames } from '../src/chain/encode.ts';
import { decodeSignal, voltToIntensity } from '../src/chain/decode.ts';
import { applyChannel } from '../src/chain/channel/index.ts';
import { highpass } from '../src/chain/channel/highpass.ts';
import { lowpass } from '../src/chain/channel/lowpass.ts';
import { toCameraOrientation, toDisplayOrientation, type Plane } from '../src/chain/scan.ts';
import { runChain } from '../src/chain/pipeline.ts';
import { encodeWav } from '../src/chain/wav.ts';
import type { Frame } from '../src/chain/types.ts';

/** Paramètres « aller-retour exact » : courbe linéaire calée sur les niveaux de l'encodeur. */
function exactParams(): ChainParams {
  const e = defaultEncode();
  const d = { ...defaultDecode(), curve: 'linear' as const, lower: e.white, upper: e.black };
  return { name: 'test', description: '', encode: e, channel: cleanChannel(), decode: d };
}

function testFrame(traces = 540, pixels = 364): Frame {
  const data = new Float32Array(traces * pixels);
  for (let t = 0; t < traces; t++) for (let p = 0; p < pixels; p++) {
    // dégradé + damier : des bords francs dans les deux directions
    data[t * pixels + p] = 0.15 + 0.7 * (t / traces) * 0.5 + (((t >> 5) + (p >> 5)) % 2 ? 0.3 : 0);
  }
  return { traces, pixels, data };
}

const mae = (a: Float32Array, b: Float32Array, pixels: number, margin = 3) => {
  let s = 0, n = 0;
  for (let i = 0; i < a.length; i++) {
    const p = i % pixels;
    if (p < margin || p >= pixels - margin) continue;
    s += Math.abs(a[i] - b[i]); n++;
  }
  return s / n;
};

test('la durée d’une trace vaut ≈ 8,32 ms (mesure du vrai signal)', () => {
  const e = defaultEncode();
  assert.ok(Math.abs(e.period / e.sampleRate * 1000 - 8.32) < 0.01);
});

test('aller-retour sans dégradation : le décodage retrouve l’image', () => {
  const p = exactParams();
  const f = testFrame();
  const r = runChain([f], p);
  const err = mae(f.data, r.frames[0].data, f.pixels);
  assert.ok(err < 0.02, `écart moyen ${err.toFixed(4)}`);
});

test('le décodeur retrouve chaque synchro sans connaître leurs positions', () => {
  const p = exactParams();
  const sig = encodeFrames([testFrame()], p.encode);
  const { marks } = decodeSignal(sig, p.decode);
  for (let k = 0; k < sig.traces; k++) assert.ok(Math.abs(marks[k] - sig.traceMarks[k]) <= 1, `trace ${k}: ${marks[k]} ≠ ${sig.traceMarks[k]}`);
});

test('les périodes alternent (paire / impaire), comme sur le disque', () => {
  const e = defaultEncode();
  const sig = encodeFrames([testFrame()], e);
  const d0 = sig.traceMarks[1] - sig.traceMarks[0], d1 = sig.traceMarks[2] - sig.traceMarks[1];
  assert.ok(Math.abs(Math.abs(d1 - d0) - e.alternation) <= 1);
});

test('image couleur : trois passages, trois trames', () => {
  const p = exactParams();
  const r = runChain([testFrame(), testFrame(), testFrame()], p);
  assert.equal(r.clean.passStarts.length, 3);
  assert.equal(r.frames.length, 3);
  for (const f of r.frames) assert.ok(mae(testFrame().data, f.data, f.pixels) < 0.02);
});

test('passe-haut : un niveau constant retombe vers zéro (couplage AC)', () => {
  const x = new Float32Array(384000).fill(0.5);
  const y = highpass(x, 384000, 20);
  assert.ok(Math.abs(y[y.length - 1]) < 1e-3);
  const z = new Float32Array(384000); z.fill(0.5, 1000);
  const w = highpass(z, 384000, 20);
  assert.ok(w[1000] > 0.49, 'le front passe');
});

test('passe-bas : une sinusoïde bien au-dessus de la coupure est atténuée', () => {
  const sr = 384000, n = 38400, x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = Math.sin(2 * Math.PI * 100000 * i / sr);
  const y = lowpass(x, sr, 10000, 2);
  let a = 0; for (let i = n / 2; i < n; i++) a = Math.max(a, Math.abs(y[i]));
  assert.ok(a < 0.05, `amplitude ${a}`);
});

test('le couplage AC crée ombre et anti-ombre derrière un objet clair', () => {
  const p = exactParams();
  p.channel.highpass = { enabled: true, cutoffHz: 60 };
  const pixels = 364, traces = 540, data = new Float32Array(traces * pixels).fill(0.3);
  for (let t = 200; t < 340; t++) for (let px = 120; px < 240; px++) data[t * pixels + px] = 0.95;
  const r = runChain([{ traces, pixels, data }], p);
  const out = r.frames[0].data;
  const t = 270;
  const before = out[t * pixels + 100], after = out[t * pixels + 260];
  // après la zone claire (plus tard dans le temps), le fond n'est plus au même niveau qu'avant
  assert.ok(Math.abs(after - before) > 0.02, `avant ${before.toFixed(3)} après ${after.toFixed(3)}`);
});

test('alternance paire/impaire : une trace sur deux décalée', () => {
  const p = exactParams();
  p.channel.evenOdd = { enabled: true, samples: 30 };
  const pixels = 364, traces = 540, data = new Float32Array(traces * pixels).fill(0.2);
  for (let t = 0; t < traces; t++) for (let px = 180; px < pixels; px++) data[t * pixels + px] = 0.9;
  const r = runChain([{ traces, pixels, data }], p);
  const edge = (t: number) => { for (let px = 150; px < 220; px++) if (r.frames[0].data[t * pixels + px] > 0.55) return px; return -1; };
  assert.notEqual(edge(100), edge(101));
  assert.equal(edge(100), edge(102));
});

test('graine identique → gravure identique ; graine différente → gravure différente', () => {
  const p = exactParams();
  p.channel.noise = { enabled: true, rms: 0.01, lowRms: 0.005, lowCutoffHz: 150, seed: 7 };
  p.channel.wowFlutter = { ...p.channel.wowFlutter, enabled: true, seed: 7 };
  const sig = encodeFrames([testFrame(60, 40)].map(() => testFrame()), p.encode);
  const a = applyChannel(sig, p.channel, p.encode).samples;
  const b = applyChannel(sig, p.channel, p.encode).samples;
  assert.deepEqual(a.subarray(0, 5000), b.subarray(0, 5000));
  p.channel.noise.seed = 8;
  const c = applyChannel(sig, p.channel, p.encode).samples;
  assert.notDeepEqual(a.subarray(0, 5000), c.subarray(0, 5000));
});

test('courbe cosinus : bornes de Barry, blanc = tension basse', () => {
  const d = defaultDecode();
  assert.equal(voltToIntensity(-0.3, d), 1);
  assert.equal(voltToIntensity(0.3, d), 0);
  assert.ok(Math.abs(voltToIntensity((d.lower + d.upper) / 2, d) - 0.5) < 1e-6);
});

test('rotation affichage ↔ caméra : aller-retour exact (orientations 1 et 2)', () => {
  const w = 7, h = 11, data = new Float32Array(w * h).map((_, i) => i);
  const p: Plane = { width: w, height: h, data };
  for (const o of [1, 2] as const) {
    const cam = toCameraOrientation(p, o);
    assert.equal(cam.width, h); assert.equal(cam.height, w);
    assert.deepEqual(toDisplayOrientation(cam, o).data, data);
  }
});

test('export WAV : en-tête RIFF valide, 384 kHz, float 32', () => {
  const buf = encodeWav(new Float32Array([0, 0.5, -0.5]), 384000, 'float32');
  const v = new DataView(buf);
  assert.equal(String.fromCharCode(v.getUint8(0), v.getUint8(1), v.getUint8(2), v.getUint8(3)), 'RIFF');
  assert.equal(v.getUint16(20, true), 3);
  assert.equal(v.getUint32(24, true), 384000);
  assert.equal(v.getFloat32(48, true), 0.5);
  assert.equal(buf.byteLength, 44 + 12);
});

test('les trois presets sont complets et passent dans la chaîne', async () => {
  const { readFileSync } = await import('node:fs');
  for (const f of ['barry-2017', 'signal-propre', 'longue-distance']) {
    const p: ChainParams = JSON.parse(readFileSync(new URL(`../presets/${f}.json`, import.meta.url), 'utf8'));
    for (const k of ['highpass', 'lowpass', 'noise', 'wowFlutter', 'evenOdd', 'rgbShift'] as const) assert.equal(typeof p.channel[k].enabled, 'boolean', `${f}: ${k}`);
    const r = runChain([testFrame(), testFrame(), testFrame()], p);
    assert.equal(r.frames.length, 3, f);
    assert.ok(r.frames.every((fr) => fr.data.every((v) => v >= 0 && v <= 1)), `${f}: valeurs hors 0–1`);
  }
});

test('Signal propre : retrouve l’image presque exactement', async () => {
  const { readFileSync } = await import('node:fs');
  const p: ChainParams = JSON.parse(readFileSync(new URL('../presets/signal-propre.json', import.meta.url), 'utf8'));
  const f = testFrame();
  assert.ok(mae(f.data, runChain([f], p).frames[0].data, f.pixels) < 0.02);
});
