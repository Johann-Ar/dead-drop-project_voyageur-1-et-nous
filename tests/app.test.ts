import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeFrames } from '../src/chain/encode.ts';
import { decodeSignal } from '../src/chain/decode.ts';
import { signalToBlock, blockToInt16, blockFromInt16, blockToAudio, BLOCK_SAMPLES, BLOCK_TRACES, BLOCK_RATE } from '../src/chain/block.ts';
import { defaultEncode, defaultDecode } from '../src/chain/params.ts';
import { sortBackToFront } from '../src/scene/sort.ts';
import { newGravureId } from '../src/app/store.ts';
import { multiply, invert, lookAt, perspective, transformPoint } from '../src/scene/math.ts';

const frame = () => { const data = new Float32Array(540 * 364); for (let i = 0; i < data.length; i++) data[i] = (i % 364) / 364; return { traces: 540, pixels: 364, data }; };

test('bloc de signal : 400 échantillons par trace ≈ 48 kHz, un bloc par passage', () => {
  assert.equal(BLOCK_RATE, 48075);
  const sig = encodeFrames([frame(), frame(), frame()], defaultEncode());
  const { marks } = decodeSignal(sig, defaultDecode());
  const b = signalToBlock(sig, marks);
  assert.equal(b.length, 3 * BLOCK_TRACES * BLOCK_SAMPLES);
  // la rampe d'intensité est bien dans la trace : début (blanc = bas) ≠ fin (noir = haut)
  const t = 100 * BLOCK_SAMPLES; assert.ok(b[t + 60] > b[t + 330] || b[t + 60] < b[t + 330]);
});

test('bloc int16 : aller-retour à ± 1/32767 près', () => {
  const x = new Float32Array([0, 0.1, -0.25, 0.39]);
  const y = blockFromInt16(blockToInt16(x, 0.4).buffer as ArrayBuffer, 0.4);
  x.forEach((v, i) => assert.ok(Math.abs(v - y[i]) < 0.4 / 32767 * 1.01));
});

test('son d’écoute : centré et normalisé sous 1', () => {
  const a = blockToAudio(new Float32Array([0.2, 0.3, 0.1, 0.4]));
  assert.ok(Math.max(...a.map(Math.abs)) <= 0.851);
  assert.ok(Math.abs(a.reduce((s, v) => s + v, 0)) < 1e-6);
});

test('splats : tri de l’arrière vers l’avant (le plus loin d’abord), sans perte', () => {
  const d = new Float32Array([0.2, 5, -1, 3, 3.0001, 0]);
  const o = sortBackToFront(d, new Uint32Array(d.length));
  for (let i = 1; i < o.length; i++) assert.ok(d[o[i - 1]] >= d[o[i]] - 1e-3, `${[...o]}`);
  assert.equal(new Set(o).size, d.length);
  const big = new Float32Array(50000).map(() => Math.random());
  const ob = sortBackToFront(big, new Uint32Array(big.length));
  for (let i = 1; i < ob.length; i++) assert.ok(big[ob[i - 1]] >= big[ob[i]] - 2 / 65535);
});

test('identifiant de gravure : DD-AAAAMMJJ-xxxx', () => {
  assert.match(newGravureId(new Date('2026-09-30T12:00:00Z')), /^DD-20260930-[A-Z2-9]{4}$/);
});

test('matrices : projection d’un point devant la caméra au centre de l’écran', () => {
  const m = multiply(perspective(1, 1, 0.1, 100), lookAt([0, 0, 5], [0, 0, 0]));
  const p = transformPoint(m, [0, 0, 0]);
  assert.ok(Math.abs(p[0]) < 1e-6 && Math.abs(p[1]) < 1e-6);
  const id = multiply(m, invert(m));
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(id[i] - (i % 5 === 0 ? 1 : 0)) < 1e-5);
});
