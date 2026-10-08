import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lossFromDiff, lossFromTraces, traceAxis } from '../src/app/loss.ts';

const img = (w: number, h: number, f: (x: number, y: number) => number) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const v = f(x, y), i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = v; data[i + 3] = 255; }
  return { data, width: w, height: h };
};

test('perte nulle quand rien ne change, forte là où l’image est abîmée', () => {
  const a = img(120, 80, () => 50);
  const b = img(120, 80, (x, y) => (x > 60 && y < 40 ? 250 : 50));
  const m = lossFromDiff(a, b);
  const at = (u: number, v: number) => m.data[Math.floor(v * m.height) * m.width + Math.floor(u * m.width)];
  assert.ok(at(0.8, 0.2) > 0.8);
  assert.ok(at(0.2, 0.8) < 0.05);
});

test('une trace qui se détache de ses voisines est repérée', () => {
  const m = lossFromTraces(img(200, 100, (x) => (x === 100 ? 250 : 100)), 'v', 200);
  const row = 50 * m.width;
  assert.ok(m.data[row + 100] > m.data[row + 20]);
  assert.equal(traceAxis(0), 'v'); assert.equal(traceAxis(2), 'h');
});
