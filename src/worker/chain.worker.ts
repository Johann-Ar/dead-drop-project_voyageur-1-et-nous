/// <reference lib="webworker" />
/**
 * Web Worker : tout le calcul de la chaîne tourne ici, l'interface reste fluide.
 */
import type { Frame } from '../chain/types.ts';
import type { ChainParams } from '../chain/params.ts';
import { runChain, prepareFrames } from '../chain/pipeline.ts';
import { encodeFrames } from '../chain/encode.ts';
import { applyChannel } from '../chain/channel/index.ts';
import { decodeSignal } from '../chain/decode.ts';
import { signalToBlock } from '../chain/block.ts';
import { framesToRGBA } from '../chain/compose.ts';
import { compare, compareColor, diffFrame, objective, type Scores } from '../calibration/metrics.ts';
import { barryFrame, barryFramesRGB, lumaFrame, nasaFrames, type PairInfo } from '../calibration/pairs.ts';
import { coordinateDescent } from '../calibration/search.ts';
import type { Request, Response } from './protocol.ts';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const pairs = new Map<string, { pair: PairInfo; kind: 'nb' | 'couleur'; nasa: Parameters<typeof nasaFrames>[0]; ref: Frame; refRGB: Frame[] | null }>();

const post = (m: Response, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

function scoreAll(params: ChainParams, ids?: string[]) {
  const per = [...pairs.values()].filter((p) => !ids || ids.includes(p.pair.id)).map(({ pair, nasa, ref }) => {
    const r = runChain(nasaFrames(nasa, pair, params), params);
    return { id: pair.id, ...compare(r.frames[0], ref, pair.frame_rect) };
  });
  const mean = (k: 'mae' | 'ssim' | 'grad') => per.reduce((s, x) => s + x[k], 0) / Math.max(per.length, 1);
  return { per, mean: { mae: mean('mae'), ssim: mean('ssim'), grad: mean('grad') }, objective: per.reduce((s, x) => s + objective(x), 0) / Math.max(per.length, 1) };
}

ctx.onmessage = async (ev: MessageEvent<Request>) => {
  const m = ev.data;
  try {
    if (m.type === 'load-pair') {
      pairs.set(m.pair.id, { pair: m.pair, kind: m.kind, nasa: m.nasa, ref: barryFrame(m.barry, m.pair.orientation), refRGB: m.kind === 'couleur' ? barryFramesRGB(m.barry, m.pair.orientation) : null });
      post({ type: 'loaded', id: m.pair.id });
    } else if (m.type === 'calibrate') {
      const t0 = performance.now();
      const p = pairs.get(m.id)!;
      const input = nasaFrames(p.nasa, p.pair, m.params, p.kind);
      const r = runChain(input, m.params);
      const o = p.pair.orientation;
      const simL = lumaFrame(r.frames);
      const scores: Scores = compare(simL, p.ref, p.pair.frame_rect);
      if (p.refRGB) scores.color = compareColor(r.frames, p.refRGB, p.pair.frame_rect);
      const res = {
        type: 'calibrated' as const, id: m.id,
        input: framesToRGBA(input, o), sim: framesToRGBA(r.frames, o), ref: framesToRGBA(p.refRGB ?? [p.ref], o),
        diff: framesToRGBA([diffFrame(simL, p.ref)], o),
        scores, ms: performance.now() - t0,
      };
      post(res, [res.input, res.sim, res.ref, res.diff].map((i) => i.data.buffer as ArrayBuffer));
    } else if (m.type === 'score-all') {
      post({ type: 'scores', ...scoreAll(m.params) });
    } else if (m.type === 'engrave') {
      const t0 = performance.now();
      const st = (stage: 'scan' | 'encode' | 'channel' | 'decode') => post({ type: 'stage', job: m.job, stage });
      st('scan');
      const prep = prepareFrames(m.image, m.params, { mode: m.mode, orientation: m.orientation, cover: true });
      st('encode');
      const clean = encodeFrames(prep.frames, m.params.encode);
      st('channel');
      const sig = applyChannel(clean, m.params.channel, m.params.encode);
      st('decode');
      const { frames, marks } = decodeSignal(sig, m.params.decode);
      const o = prep.orientation;
      const res = {
        type: 'engraved' as const, job: m.job, orientation: o, passes: frames.length,
        scanned: framesToRGBA(prep.frames, o), decoded: framesToRGBA(frames, o),
        separations: !m.leger && frames.length === 3 ? frames.map((f) => framesToRGBA([f], o)) : [],
        block: m.leger ? new Float32Array(0) : signalToBlock(sig, marks), signal384: m.fidele ? sig.samples : undefined, ms: performance.now() - t0,
      };
      const tr: Transferable[] = [res.scanned.data.buffer as ArrayBuffer, res.decoded.data.buffer as ArrayBuffer, res.block.buffer as ArrayBuffer, ...res.separations.map((x) => x.data.buffer as ArrayBuffer)];
      if (res.signal384) tr.push(res.signal384.buffer as ArrayBuffer);
      post(res, tr);
    } else if (m.type === 'optimize') {
      const ids = [...pairs.keys()].filter((_, i) => i % m.subset === 0);
      let n = 0;
      const res = await coordinateDescent(m.params, m.knobs, (p) => { n++; return scoreAll(p, ids).objective; }, m.rounds,
        (step) => post({ type: 'progress', step, evaluations: n }));
      post({ type: 'optimized', params: res.params, score: res.score, log: res.log });
    }
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e), job: (m as { job?: number }).job });   // l'erreur dit quel travail a échoué
  }
};
