/**
 * La visionneuse : une image, en volume, au centre de l'écran.
 * Glisser pour tourner un peu autour, molette / pincement pour approcher.
 * Au repos, l'image oscille très lentement (on sent le volume sans rien toucher).
 */
import { setGoldAxis, forgetGold } from '../scene/goldmat.ts';
import { createContext } from '../scene/gl.ts';
import { lookAt, perspective, clamp, lerp, easeInOut, multiply, translation, rotationY } from '../scene/math.ts';
import { SplatImage, stepOf, type SplatLook, type LossMap } from '../scene/splats.ts';
import { MatterPlate } from '../scene/matter.ts';
import { LineSheet } from '../scene/lines.ts';
import { textureFromSource } from '../scene/gl.ts';

const easeOutQuart = (t: number) => 1 - Math.pow(1 - t, 4);
const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
/** Distance minimale de la caméra (zoom avant maximal). */
const ZMIN = 3.8;  // zoom avant max (un peu plus proche)
const ZMAX = 5.2;  // pas de dézoom : la taille de départ est la plus petite
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

export class Viewer {
  readonly canvas: HTMLCanvasElement;
  readonly ok: boolean;
  private gl: WebGL2RenderingContext | null;
  private splats: SplatImage | null = null;
  private matter: MatterPlate | null = null;
  private lines: LineSheet | null = null;
  private lineTex: WebGLTexture | null = null; private lineSrc: unknown = null;
  private matterSrc: unknown = null;
  look: SplatLook;
  autoMotion = true;
  private distTo = 5.2;
  private yaw = 0; private pitch = 0; private dist = 6.2;
  private vYaw = 0; private vPitch = 0;
  private side = 1; private intro = 0;
  private drag: [number, number] | null = null;
  private pointers = new Map<number, [number, number]>();
  private pinch = 0;
  private running = false;
  private t0 = performance.now();
  private anims: { from: number; to: number; dur: number; start: number; ease: boolean | ((t: number) => number); set: (v: number) => void; done: () => void }[] = [];
  private scale = 1; private slow = 0;

  constructor(canvas: HTMLCanvasElement, look: SplatLook) {
    this.canvas = canvas; this.look = look;
    this.gl = createContext(canvas, true);
    this.ok = !!this.gl;
    if (!this.gl) return;
    this.splats = new SplatImage(this.gl);
    this.matter = new MatterPlate(this.gl);
    this.lines = new LineSheet(this.gl);
    // perte du contexte 3D (veille de la carte graphique, trop d'onglets) : on le récupère et on refait tout
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); });
    canvas.addEventListener('webglcontextrestored', () => {
      const gl = this.gl; if (!gl) return;
      forgetGold(gl);
      this.splats = new SplatImage(gl); this.matter = new MatterPlate(gl); this.lines = new LineSheet(gl);
      this.matterSrc = null; this.lineSrc = null; this.lineTex = null;
      if (this.lastSrc) { this.build(this.lastSrc); this.splats.reveal = 1; this.splats.appear = 1; }
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && !this.over(e.clientX, e.clientY)) return;   // on ne saisit l'image que sur l'image elle-même
      canvas.setPointerCapture?.(e.pointerId);
      this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 2) { const [a, b] = [...this.pointers.values()]; this.pinch = Math.hypot(a[0] - b[0], a[1] - b[1]); this.drag = null; }
      else this.drag = [e.clientX, e.clientY];
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.drag) canvas.classList.toggle('prise', this.over(e.clientX, e.clientY));   // la main n'apparaît qu'au-dessus de l'image
      if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, [e.clientX, e.clientY]);
      if (this.pointers.size === 2 && this.pinch) {
        const [a, b] = [...this.pointers.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        this.distTo = clamp(this.distTo * this.pinch / d, ZMIN, ZMAX); this.pinch = d; return;
      }
      if (!this.drag) return;
      const h = canvas.clientHeight || 1;
      this.vYaw = (this.drag[0] - e.clientX) / h * 2.4; this.vPitch = (e.clientY - this.drag[1]) / h * 2.4;   /* horizontal inversé */
      this.yaw = clamp(this.yaw + this.vYaw, -1.1, 1.1); this.pitch = clamp(this.pitch + this.vPitch, -0.9, 0.9);
      this.drag = [e.clientX, e.clientY];
    });
    const up = (e: PointerEvent) => { this.pointers.delete(e.pointerId); if (this.pointers.size < 2) this.pinch = 0; if (!this.pointers.size) this.drag = null; };
    canvas.addEventListener('pointerup', up); canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', (e) => { if (!e.ctrlKey) return; /* la molette fait défiler les images ; pincement (ctrl) = zoom */ e.preventDefault(); this.distTo = clamp(this.distTo * Math.exp(e.deltaY * 0.004), ZMIN, ZMAX); }, { passive: false });
  }

  /** Le curseur est-il au-dessus de l'image en volume (rectangle de l'image à sa distance actuelle) ? */
  private aspect = 1.5;
  over(x: number, y: number) {
    const c = this.canvas, cw = c.clientWidth || innerWidth, ch = c.clientHeight || innerHeight;
    const r = Viewer.rectFor(this.aspect, cw, ch), s = 6.2 / Math.max(this.dist, 0.1);
    const w = r.width * s / 2, h = r.height * s / 2;
    return Math.abs(x - cw / 2) <= w && Math.abs(y - ch / 2) <= h;
  }

  /** Remet la caméra de face. */
  resetView() { this.yaw = 0; this.pitch = 0; this.dist = this.distTo = 5.2; /* taille de base plus grande */ this.vYaw = this.vPitch = 0; this.t0 = performance.now(); }

  /** Rectangle (px CSS) qu'occupe à l'écran une image de ce format, vue de face au repos. */
  static rectFor(aspect: number, cw = innerWidth, ch = innerHeight) {
    const a = cw / Math.max(ch, 1);
    const fov = 2 * Math.atan(Math.max(0.62, 0.62 * 1.45 / a));
    const halfW = aspect >= 1 ? 2 : 2 * aspect, halfH = aspect >= 1 ? 2 / aspect : 2;
    const k = (ch / 2) / (6.2 * Math.tan(fov / 2));
    const w = 2 * halfW * k, h = 2 * halfH * k;
    return { left: (cw - w) / 2, top: (ch - h) / 2, width: w, height: h };
  }

  private axis: 'v' | 'h' = 'v';
  private lastSrc: (CanvasImageSource & { width: number; height: number }) | null = null;
  private loss: LossMap | null = null;

  /**
   * Affiche une image. `appear` : les splats se condensent depuis un nuage.
   * `axis` : sens des traces. `loss` : carte de perte (null pendant la lecture).
   * Les images couleur arrivent en trois nappes R, V, B qui se rejoignent.
   */
  setImage(src: CanvasImageSource & { width: number; height: number }, appear = true, axis: 'v' | 'h' = 'v', loss: LossMap | null = null, key?: string) {
    if (!this.splats) return;
    this.aspect = src.width / Math.max(1, src.height);
    src = stretchLevels(src, key);        // volume seulement : noirs et blancs tirés jusqu'au bout
    for (const a of this.anims) a.done();
    this.anims = [];
    this.axis = axis; this.loss = loss; setGoldAxis(axis);   // la matière d'or suit le sens des dégradations
    this.build(src);
    const sp = this.splats;
    sp.reveal = 1;
    const anim = appear && !reduceMotion;
    sp.appear = anim ? 0 : 1;
    if (anim) this.tween(0, 1, 1000, (v) => { sp.appear = v; });
    // apparition : elle arrive franchement tournée d'un côté, puis pivote lentement vers nous
    this.side = Math.random() < 0.5 ? -1 : 1;
    if (anim) this.tween(0.5, 0, 4800, (v) => { this.intro = v; }); else this.intro = 0;
    if (sp.isTrichrome) {
      if (anim) { sp.sep = 1.2; this.tween(1.2, 0.06, 1900, (v) => { sp.sep = v; }); } else sp.sep = 0.06;
    } else sp.sep = 0;
  }

  private build(src: CanvasImageSource & { width: number; height: number }) {
    this.splats!.setImage(src, stepOf(this.look), this.axis, false);   // plus de couleur : jamais de passages R, V, B séparés
    if (this.look.matter > 0.01 && this.matterSrc !== src) { this.matter!.setImage(src); this.matterSrc = src; }
    this.lastSrc = src;
    this.splats!.setLoss(this.loss);
  }

  /** Reconstruit les splats avec les réglages actuels (densité, trichromie). */
  rebuild(src: CanvasImageSource & { width: number; height: number }) {
    if (!this.splats) return;
    this.build(src);
    this.splats.sep = this.splats.isTrichrome ? 0.06 : 0;
  }

  /** Remplace la carte de perte (quand elle arrive après l'image). */
  setLoss(loss: LossMap | null) { this.loss = loss; this.splats?.setLoss(loss); }

  /** Vol de l'image : 0 = posée sur sa vignette (rectangle donné par `flyFrom`), 1 = au centre. */
  private flyK = 1;
  private flyFrom: (() => { left: number; top: number; width: number; height: number } | null) | null = null;
  /** Pas de vol : l'image est directement à sa place centrale. */
  resetFly() { this.flyK = 1; this.flyFrom = null; }
  /** L'image part de sa vignette et vient au centre. */
  flyIn(from: () => { left: number; top: number; width: number; height: number } | null, dur = 560): Promise<void> {
    this.flyFrom = from; this.flyK = 0;
    return this.tween(0, 1, reduceMotion ? 0 : dur, (v) => { this.flyK = v; }, easeOutQuart);
  }
  /** L'image retourne se poser sur sa vignette. */
  flyOut(to: () => { left: number; top: number; width: number; height: number } | null, dur = 480): Promise<void> {
    this.flyFrom = to;
    for (const a of this.anims) a.done();
    this.anims = [];
    return this.tween(this.flyK, 0, reduceMotion ? 0 : dur, (v) => { this.flyK = v; }, easeInOutQuad);
  }

  /** Efface le canevas (aucune image périmée au prochain affichage). */
  clear() { const gl = this.gl; if (!gl) return; gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); }

  /** Décalage horizontal de l'image (−1 : sortie à gauche, 1 : entrée par la droite), avec une légère courbure. */
  private slide = 0;
  private sliding = false;
  get busy() { return this.sliding; }

  /**
   * Passe à l'image suivante (dir = 1) ou précédente (−1) : l'image glisse de côté en s'incurvant,
   * `swap` installe la nouvelle, qui arrive de l'autre côté.
   */
  async transition(dir: 1 | -1, swap: () => Promise<void>) {
    if (!this.splats || this.sliding) { await swap(); return; }
    this.sliding = true;
    try {
      if (!reduceMotion) await this.tween(0, -dir, 320, (v) => { this.slide = v; });
      await swap();
      this.slide = reduceMotion ? 0 : dir;
      if (!reduceMotion) await this.tween(dir, 0, 460, (v) => { this.slide = v; });
    } finally { this.slide = 0; this.sliding = false; }
  }

  /** Balayage de chargement : l'image se lit de gauche à droite, une ligne dorée avance. */
  scan(dur: number): Promise<void> {
    if (!this.splats) return Promise.resolve();
    this.splats.appear = 1; this.splats.reveal = reduceMotion ? 1 : 0;
    return this.tween(0, 1, reduceMotion ? 0 : dur, (v) => { this.splats!.reveal = v; }, false);
  }

  /** Disparition : l'apparition à l'envers — les splats rentrent dans la plaque, qui s'aplatit, et l'image se détourne. */
  vanish(dur = 900): Promise<void> {
    const sp = this.splats;
    if (!sp || reduceMotion) return Promise.resolve();
    for (const a of this.anims) a.done();
    this.anims = [];
    this.tween(this.intro, 0.5, dur, (v) => { this.intro = v; });
    if (sp.isTrichrome) this.tween(sp.sep, 1.2, dur, (v) => { sp.sep = v; });
    return this.tween(sp.appear, 0, dur, (v) => { sp.appear = v; });
  }

  /** Les splats se défont (avant d'afficher le résultat). */
  dissolve(dur = 600): Promise<void> {
    if (!this.splats || reduceMotion) return Promise.resolve();
    return this.tween(1, 0, dur, (v) => { this.splats!.appear = v; });
  }

  private tween(from: number, to: number, dur: number, set: (v: number) => void, ease: boolean | ((t: number) => number) = true): Promise<void> {
    return new Promise((done) => {
      if (dur <= 0) { set(to); done(); return; }
      this.anims.push({ from, to, dur, start: performance.now(), ease, set, done });
    });
  }

  // une seule boucle d'animation à la fois (sinon chaque ouverture en ajoutait une : la page finissait par saturer)
  private loopId = 0;
  start() { if (this.running || !this.gl) return; this.running = true; this.t0 = performance.now(); const id = ++this.loopId; requestAnimationFrame((t) => this.frame(t, id)); }
  stop() { this.running = false; this.loopId++; }

  private last = performance.now();
  private frame = (now: number, id: number) => {
    if (!this.running || id !== this.loopId || !this.gl || !this.splats) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    // animations
    this.anims = this.anims.filter((a) => {
      const t = clamp((now - a.start) / a.dur);
      a.set(lerp(a.from, a.to, typeof a.ease === 'function' ? a.ease(t) : a.ease ? easeInOut(t) : t));
      if (t >= 1) { a.done(); return false; }
      return true;
    });
    // inertie et oscillation lente
    if (!this.drag) {
      this.yaw = clamp(this.yaw + this.vYaw, -1.1, 1.1); this.pitch = clamp(this.pitch + this.vPitch, -0.9, 0.9);
      const k = Math.pow(0.002, dt); this.vYaw *= k; this.vPitch *= k;
    }
    const t = (now - this.t0) / 1000;
    this.dist += (this.distTo - this.dist) * (1 - Math.pow(0.0005, dt));   // zoom fluide
    // jamais de face : l'image reste tournée d'un côté (on voit le relief), et oscille sans repasser par la face
    const sway = this.side * ((this.autoMotion && !reduceMotion ? 0.17 + 0.12 * Math.sin(t * 0.55) : 0.15) + this.intro);
    const swayP = this.autoMotion && !reduceMotion ? 0.15 * Math.sin(t * 0.47 + 1) : 0;
    // résolution adaptative
    if (dt > 0.04) { if (++this.slow > 15) { this.scale = Math.max(0.5, this.scale * 0.85); this.slow = 0; } } else this.slow = 0;
    const gl = this.gl, c = this.canvas;
    const dpr = Math.min(devicePixelRatio || 1, 2) * this.scale;
    const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    // en vol (de la vignette au centre, ou retour), l'image reste de face et à distance de repos
    const fk = this.flyK, dist = 6.2 + (this.dist - 6.2) * fk;
    const yaw = (this.yaw + sway) * fk, pitch = (this.pitch + swayP) * fk;
    const eye: [number, number, number] = [dist * Math.sin(yaw) * Math.cos(pitch), dist * Math.sin(pitch), dist * Math.cos(yaw) * Math.cos(pitch)];
    // l'image tient dans l'écran quel que soit le format
    const aspect = w / Math.max(h, 1);
    const fov = 2 * Math.atan(Math.max(0.62, 0.62 * 1.45 / aspect));   // l'image occupe ~ 60 % de l'écran : l'accueil reste visible autour
    const proj = perspective(fov, aspect, 0.05, 100);
    let view = lookAt(eye, [0, 0, 0]);
    if (this.slide) {
      // glissement de droite à gauche, courbé : l'image recule et pivote un peu en passant
      const sl = this.slide, k = Math.abs(sl);
      view = multiply(view, multiply(translation(sl * 5.2, 0, -k * 1.4), rotationY(-sl * 0.55)));
    }
    // déplacement à l'écran : de la vignette (fk = 0) à la place centrale (fk = 1)
    let scr: [number, number, number, number] = [1, 1, 0, 0];
    const box = fk < 1 && this.flyFrom ? this.flyFrom() : null;
    if (box && this.splats) {
      const cw = c.clientWidth, ch = c.clientHeight, C = Viewer.rectFor(this.splats.halfW / this.splats.halfH, cw, ch);
      const sx = box.width / C.width, sy = box.height / C.height;
      const tx = (box.left + box.width / 2 - cw / 2) / (cw / 2), ty = -(box.top + box.height / 2 - ch / 2) / (ch / 2);
      scr = [sx + (1 - sx) * fk, sy + (1 - sy) * fk, tx * (1 - fk), ty * (1 - fk)];
    }
    this.splats.screen = scr; if (this.matter) this.matter.screen = scr;
    this.splats.gold = fk * (Number.isFinite(this.look.gold) ? this.look.gold : 1);   // réglage « Or »
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const L = this.look, sp = this.splats;
    // le tirage (cadre + titre) est toujours là ; avec « Matière », la fenêtre de l'image devient plaque
    sp.sheen = yaw * 1.8 + pitch * 0.8 + (reduceMotion ? 0 : Math.sin(t * 0.25) * 0.3);
    // modes de rendu (réglages) : splats · splats + plaque · plaque gravée · relief lisse · lignes gravées
    const mode = L.render ?? 'mixte', gold = Number.isFinite(L.gold) ? L.gold : 1;
    const mat = mode === 'plaque' || mode === 'lisse' ? 1 : mode === 'mixte' ? (Number(L.matter) || 0) : 0;
    sp.edgeZ = this.matter && mat > 0.01 ? (this.matter.minL - 0.5) * L.height * (mode === 'mixte' ? 1 - L.native : 1) - 0.012 : 0;
    if (this.matter && mat > 0.01) {
      if (this.lastSrc && this.matterSrc !== this.lastSrc) { this.matter.setImage(this.lastSrc); this.matterSrc = this.lastSrc; }
      this.matter.draw(proj, view, eye, [sp.halfW, sp.halfH], this.axis, {
        height: L.height * (mode === 'mixte' ? 1 - L.native : 1), thin: (L.plaque ?? 0.035) / 3,
        grooves: 270, depth: mode === 'lisse' ? 0 : 0.35 * mat, imageOn: true, alpha: mat, gold, smooth: mode === 'lisse',
      }, sp.appear);
    }
    if (mode === 'lignes' && this.lines && this.lastSrc) {
      if (this.lineSrc !== this.lastSrc) {
        if (this.lineTex) gl.deleteTexture(this.lineTex);
        this.lineTex = textureFromSource(gl, this.lastSrc as TexImageSource, { mipmap: true }); this.lineSrc = this.lastSrc;
      }
      gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.disable(gl.DEPTH_TEST);
      this.lines.draw({
        proj, view, img: this.lineTex!, imgAspect: sp.halfW / sp.halfH, aspect: sp.halfW / sp.halfH, W: 2 * sp.halfW, center: [0, 0, 0],
        relief: L.height * 0.8, alpha: sp.appear, lines: Math.round(300 * Math.pow(2, (L.density ?? 0) / 2)), axis: this.axis, time: t, gold, gain: 0.9,
      });
      gl.disable(gl.BLEND);
    } else if (mode === 'splats' || mode === 'mixte') {
      sp.depthTest = true;
      sp.draw(proj, view, h, L, t);
    }
    requestAnimationFrame((t) => this.frame(t, id));
  };
}

/**
 * Niveaux automatiques, pour le volume seulement (l'image d'origine n'est jamais modifiée) :
 * le gris le plus sombre de l'image (0,5 % des points) devient noir, le plus clair (99,5 %) blanc.
 * Toutes les images ont ainsi la même grande plage de contraste, même celles sans vrai noir ni vrai blanc.
 */
const levelCache = new WeakMap<object, HTMLCanvasElement>();
// par image (identifiant) : rouvrir la même image ne refait pas le calcul ; quelques entrées seulement
export const levelById = new Map<string, HTMLCanvasElement>();
function stretchLevels(src: CanvasImageSource & { width: number; height: number }, key?: string): CanvasImageSource & { width: number; height: number } {
  const byId = key ? levelById.get(key) : undefined;
  if (byId && byId.width === src.width && byId.height === src.height) return byId;
  const hit = levelCache.get(src as object); if (hit) return hit;
  const keep = (c: HTMLCanvasElement) => { if (key) { levelById.delete(key); levelById.set(key, c); if (levelById.size > 8) levelById.delete(levelById.keys().next().value!); } return c; };
  const w = src.width, h = src.height;
  if (!w || !h) return src;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return src;
  g.drawImage(src, 0, 0);
  const id = g.getImageData(0, 0, w, h), d = id.data;
  const hist = new Uint32Array(256);
  const stepPx = Math.max(1, Math.floor((w * h) / 200000)) * 4;          // échantillon : rapide même sur une grande image
  let n = 0;
  for (let i = 0; i < d.length; i += stepPx) { hist[(d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29) >> 8]++; n++; }
  const at = (q: number) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= q * n) return v; } return 255; };
  const lo = at(0.005), hi = at(0.995);
  if (hi - lo < 8 || (lo <= 2 && hi >= 253)) { levelCache.set(src as object, c); return keep(c); }   // déjà pleine plage
  const lut = new Uint8ClampedArray(256), k = 255 / (hi - lo);
  for (let v = 0; v < 256; v++) lut[v] = (v - lo) * k;
  for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  g.putImageData(id, 0, 0);
  levelCache.set(src as object, c);
  return keep(c);
}
