/**
 * Splats « natifs du signal ».
 *
 * Chaque gaussienne est un morceau de la transmission, pas un pixel mis en relief :
 * - elle est étirée dans le sens du balayage (les traces verticales de la machine de 1977) ;
 * - la PERTE mesurée (écart entre l'image avant et après la chaîne) la détache du plan,
 *   la rend plus floue et plus transparente : ce que le voyage a abîmé flotte et se dissout ;
 * - en couleur, les trois passages R, V, B sont trois nappes séparées qui se rejoignent,
 *   comme les trois gravures successives recomposées au décodage.
 * Le mode « gris » (relief par la luminance) reste disponible pour comparer.
 * Principe du rendu : Gaussian Splatting (Kerbl et al., 2023) — gaussiennes triées de l'arrière
 * vers l'avant, mélangées par transparence ; ici posées depuis l'image, pas apprises.
 */
import { createProgram, buffer, attrib, type Program } from './gl.ts';
import { sortBackToFront } from './sort.ts';
import { GOLD_GLSL, bindGold } from './goldmat.ts';
import type { Mat4 } from './math.ts';

const VS = `#version 300 es
precision highp float;
precision highp int;
in vec3 aPos;          // x, y (monde), luminance lissée 0–1
in vec4 aCol;          // couleur (déjà limitée à un canal en trichromie)
in vec4 aRnd;          // aléas : x, y, taille, retard
in vec2 aLoss;         // perte 0–1 · canal (−1 = tous, 0/1/2 = R/V/B)
uniform mat4 uProj, uView;
uniform vec2 uAxis;    // sens des traces dans le plan de l'image
uniform float uNative, uHeight, uSpacing, uSize, uJitter, uViewportH, uAppear, uReveal, uHalfW, uMaxPoint, uTime, uBreath, uAniso, uSep, uDrift;
uniform float uGold, uSheen;
uniform vec4 uScreen;
uniform float uHalfH; uniform float uEdgeZ; uniform float uShape;   // forme : 0 points · 1 traits fins · 2 traits longs · 3 hachures croisées · 4 traits libres
          // demi-hauteur (coins arrondis)          // déplacement à l'écran (échelle xy, décalage xy) : l'image vole de sa vignette au centre   // or du disque · position du reflet (suit le regard)
out vec4 vCol; out float vScan; out vec2 vDir; out float vAniso; out float vSoftK; out float vLen;
vec3 goldRamp(float l) {           // teintes relevées sur la photo du disque (du sillon sombre au reflet)
  l = pow(clamp(l, 0.0, 1.0), 0.8);
  vec3 c = mix(vec3(0.16, 0.10, 0.03), vec3(0.43, 0.27, 0.03), smoothstep(0.0, 0.35, l));
  c = mix(c, vec3(0.62, 0.46, 0.05), smoothstep(0.35, 0.6, l));
  c = mix(c, vec3(0.80, 0.66, 0.14), smoothstep(0.6, 0.85, l));
  return mix(c, vec3(0.95, 0.88, 0.55), smoothstep(0.85, 1.0, l));
}
${GOLD_GLSL}
void main() {
  float loss = aLoss.x, chan = aLoss.y;
  // position de base (avec un léger désordre)
  vec3 p = vec3(aPos.xy + (aRnd.xy - 0.5) * uSpacing * uJitter, 0.0);
  // mode gris : relief par la luminance · mode signal : ce qui est perdu se détache et dérive le long de la trace
  float zGray = (aPos.z - 0.5) * uHeight;
  float zSig = loss * uHeight * 1.3 * (0.6 + 0.8 * aRnd.w);
  p.xy += uAxis * (aRnd.z - 0.5) * loss * uDrift * uSpacing * 12.0 * uNative;
  p.z = mix(zGray, zSig, uNative);
  // trichromie : les passages sont des nappes séparées
  if (chan >= 0.0) p.z += (chan - 1.0) * uSep;
  p.z += sin(uTime * 0.7 + aRnd.w * 40.0) * uBreath * uSpacing * (1.0 + 3.0 * loss * uNative);
  // marge sur les bords : les splats s'y aplatissent jusqu'au niveau du bord de la plaque,
  // pour que la tranche garde partout la même épaisseur
  float dEdge = min(uHalfW - abs(aPos.x), uHalfH - abs(aPos.y));
  p.z = mix(uEdgeZ, p.z, smoothstep(0.0, 0.07 * min(uHalfW, uHalfH), dEdge));
  // apparition : chaque splat part de sa place sur l'image à plat (la plaque) et s'en décroche pour former le volume
  vec3 from = vec3(p.xy, -0.012);
  float a = smoothstep(aRnd.w * 0.55, aRnd.w * 0.55 + 0.45, uAppear);
  p = mix(from, p, a);
  vec4 c = uView * vec4(p, 1.0);
  gl_Position = uProj * c;
  // étirement dans le sens des traces, en coordonnées écran
  vec4 c2 = uProj * uView * vec4(p + vec3(uAxis, 0.0) * 0.05, 1.0);
  vec2 d = c2.xy / c2.w - gl_Position.xy / gl_Position.w;
  vDir = length(d) > 1e-6 ? normalize(vec2(d.x, -d.y)) : vec2(0.0, 1.0);
  float aniso = mix(1.0, uAniso, uNative);
  vLen = 1.0;
  if (uShape > 0.5) {                                  // en traits plutôt qu'en points
    vLen = 0.4;                                        // le trait occupe toute la longueur du point
    float lk = uShape > 1.5 && uShape < 2.5 ? 10.0 : 5.0;
    aniso = max(aniso, 1.0) * lk;
    if (uShape > 2.5 && uShape < 3.5 && aRnd.y > 0.5) vDir = vec2(-vDir.y, vDir.x);   // hachures : la moitié à angle droit
    if (uShape > 3.5) { float r = (aRnd.y - 0.5) * 2.4; vDir = mat2(cos(r), sin(r), -sin(r), cos(r)) * vDir; }   // traits libres : chacun son angle
  }
  vAniso = aniso;
  float grow = 1.0 + 1.6 * loss * uNative;
  float size = uSpacing * uSize * (0.7 + 0.6 * aRnd.z) * sqrt(aniso) * grow;
  gl_PointSize = clamp(size * uProj[1][1] * uViewportH * 0.5 / max(-c.z, 0.01), 1.0, uMaxPoint);
  vSoftK = mix(1.0, 0.45, loss * uNative);           // plus de perte = plus flou
  // balayage de chargement
  float u = aPos.x / uHalfW * 0.5 + 0.5;
  float seen = step(u, uReveal);
  vScan = seen * (1.0 - smoothstep(0.0, 0.035, uReveal - u)) * step(uReveal, 0.999);
  float conf = mix(1.0, mix(1.0, 0.22, loss), uNative);  // confiance du décodage
  float shade = mix(0.86 + 0.28 * aPos.z, 1.0, uNative);
  vec3 base = vec3(dot(aCol.rgb, vec3(0.299, 0.587, 0.114))) * shade;   // pas de couleur : niveaux de gris
  // l'or du disque : les gris deviennent dorés, avec un reflet qui glisse quand on tourne l'image
  float l = dot(base, vec3(0.299, 0.587, 0.114));
  vec3 gold = discGold(l, aPos.xy / vec2(2.0 * uHalfW, -2.0 * uHalfH) + 0.5);
  float band = exp(-pow(aPos.x / uHalfW * 0.75 + aPos.y / uHalfW * 0.3 + p.z * 0.5 - uSheen, 2.0) * 5.0);
  gold += vec3(1.0, 0.94, 0.5) * band * (0.2 + 0.8 * l) * 0.6;
  gl_Position.xy = gl_Position.xy * uScreen.xy + uScreen.zw * gl_Position.w;
  gl_PointSize = max(1.0, gl_PointSize * uScreen.x);
  // coins légèrement arrondis
  float rc = 0.05 * min(uHalfW, uHalfH);
  vec2 qc = abs(aPos.xy) - vec2(uHalfW, uHalfH) + rc;
  float corner = (qc.x > 0.0 && qc.y > 0.0 && length(qc) > rc) ? 0.0 : 1.0;
  vCol = vec4(mix(base, gold, uGold), aCol.a * a * seen * conf * corner);
}`;

const FS = `#version 300 es
precision highp float;
in vec4 vCol; in float vScan; in vec2 vDir; in float vAniso; in float vSoftK; in float vLen;
uniform float uSoft;
out vec4 o;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float along = dot(d, vDir) * vLen, across = dot(d, vec2(-vDir.y, vDir.x)) * vAniso;
  float r2 = (along * along + across * across) * 4.0;
  float g = exp(-r2 * uSoft * vSoftK);
  float alpha = g * vCol.a;
  if (alpha < 0.008) discard;
  vec3 col = vCol.rgb + vec3(0.95, 0.74, 0.38) * vScan * 1.4;
  o = vec4(col * alpha, alpha);                 // alpha prémultiplié
}`;

export interface SplatLook {
  height: number;   // hauteur du relief / du détachement
  size: number;     // taille des splats (× écart entre points)
  soft: number;     // netteté
  jitter: number;   // désordre
  breath: number;   // flottement
  step: number;     // densité : 1 splat pour `step` points
  native: number;   // 0 = relief par les gris · 1 = splats natifs du signal
  aniso: number;    // étirement dans le sens des traces
  drift: number;    // dérive des splats abîmés le long de la trace
  trichrome: boolean; // passages R, V, B séparés (images couleur)
  forme?: 'points' | 'fins' | 'longs' | 'hachures' | 'libres';   // forme des splats (réglages)
  matter: number;     // 0–1 : l'image devient plaque (tôle fine gravée qui épouse le relief)
  gold: number;       // 0–1 : niveaux de gris → or du disque
  render?: 'splats' | 'mixte' | 'plaque' | 'lisse' | 'lignes';   // mode de rendu de l'image en volume
  density: number;    // densité des splats : 0 = une par point du signal ; + plus dense, − moins dense
  plaque: number;     // épaisseur du tirage (cadre et plaque)
}

export const DEFAULT_LOOK: SplatLook = { height: 1.2, size: 3.0, soft: 3.2, jitter: 0.35, breath: 0.2, step: 2, native: 1, aniso: 2.0, drift: 0.6, trichrome: true, matter: 0, density: 0, plaque: 0.035, gold: 1 };

/** Pas de la grille de splats selon la densité (0 → 1 ; +2 → 0,5 ; −2 → 2). */
export const stepOf = (l: SplatLook) => Math.pow(2, -(Number.isFinite(l.density) ? l.density : 0) / 2);

export interface LossMap { data: Float32Array; width: number; height: number }

export class SplatImage {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject | null = null;
  private bufs: WebGLBuffer[] = [];
  private idxBuf: WebGLBuffer | null = null;
  private n = 0;
  private pos = new Float32Array(0);
  private lossAttr = new Float32Array(0);
  private lossBuf: WebGLBuffer | null = null;
  private order = new Uint32Array(0);
  private dist = new Float32Array(0);
  private lastKey = '';
  private channels = 1;
  spacing = 0.01;
  halfW = 1; halfH = 1;
  appear = 1;
  reveal = 1;
  sep = 0;
  axis: [number, number] = [0, 1];
  maxPoint = 64;
  /** true : les splats respectent la profondeur (cachés derrière la matière), sans l'écrire. */
  depthTest = false;
  gold = 1;
  edgeZ = 0;     // niveau des bords (celui du bord de la plaque)
  sheen = 0;
  screen: [number, number, number, number] = [1, 1, 0, 0];

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    const r = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array;
    this.maxPoint = Math.min(r?.[1] ?? 64, 256);
  }

  /**
   * Construit les splats. `traceAxis` : sens des traces dans l'image affichée
   * ('v' pour une image paysage, 'h' pour un portrait couché sous la caméra).
   * `trichrome` : trois nappes R, V, B (sinon une seule, en couleur).
   */
  setImage(src: CanvasImageSource & { width: number; height: number }, step: number, traceAxis: 'v' | 'h', trichrome: boolean, box = 4) {
    const gl = this.gl;
    const long = Math.max(src.width, src.height), k = Math.round(540 / step) / long;
    const W = Math.max(8, Math.round(src.width * k)), H = Math.max(8, Math.round(src.height * k));
    const c = new OffscreenCanvas(W, H), g = c.getContext('2d', { willReadFrequently: true })!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(src, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const lum = new Float32Array(W * H);
    let sat = 0;
    for (let i = 0; i < W * H; i++) {
      const r = px[i * 4], gg = px[i * 4 + 1], b = px[i * 4 + 2];
      lum[i] = (0.2126 * r + 0.7152 * gg + 0.0722 * b) / 255;
      if (Math.max(r, gg, b) - Math.min(r, gg, b) > 24) sat++;
    }
    const isColor = sat / (W * H) > 0.05;
    this.channels = trichrome && isColor ? 3 : 1;
    const sm = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, kk = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const xx = Math.min(W - 1, Math.max(0, x + dx)), yy = Math.min(H - 1, Math.max(0, y + dy));
        const w = 1 / (1 + dx * dx + dy * dy); s += lum[yy * W + xx] * w; kk += w;
      }
      sm[y * W + x] = 0.55 * (s / kk) + 0.45 * lum[y * W + x];
    }
    const scale = W >= H ? box / W : box / H;
    this.spacing = scale; this.halfW = W * scale / 2; this.halfH = H * scale / 2;
    this.axis = traceAxis === 'v' ? [0, 1] : [1, 0];
    const C = this.channels, n = W * H * C;
    const pos = new Float32Array(n * 3), col = new Uint8Array(n * 4), rnd = new Float32Array(n * 4), loss = new Float32Array(n * 2);
    let seed = 1234567;
    const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return seed / 4294967296; };
    for (let ch = 0; ch < C; ch++) for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, j = ch * W * H + i;
      pos[j * 3] = (x + 0.5) * scale - this.halfW;
      pos[j * 3 + 1] = this.halfH - (y + 0.5) * scale;
      pos[j * 3 + 2] = sm[i];
      for (let q = 0; q < 3; q++) col[j * 4 + q] = C === 3 ? (q === ch ? px[i * 4 + q] : 0) : px[i * 4 + q];
      const ex = Math.min(x, W - 1 - x) / W, ey = Math.min(y, H - 1 - y) / H;
      col[j * 4 + 3] = Math.round(255 * Math.min(1, Math.min(ex, ey) * 22) * (0.78 + 0.22 * rand()));
      rnd[j * 4] = rand(); rnd[j * 4 + 1] = rand(); rnd[j * 4 + 2] = rand(); rnd[j * 4 + 3] = rand();
      loss[j * 2] = 0; loss[j * 2 + 1] = C === 3 ? ch : -1;
    }
    for (const b of this.bufs) gl.deleteBuffer(b);
    if (this.idxBuf) gl.deleteBuffer(this.idxBuf);
    if (this.vao) gl.deleteVertexArray(this.vao);
    this.vao = gl.createVertexArray()!;
    gl.bindVertexArray(this.vao);
    const bp = buffer(gl, pos), bc = buffer(gl, col), br = buffer(gl, rnd);
    this.lossAttr = loss;
    this.lossBuf = buffer(gl, loss, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    attrib(gl, this.prog.a.aPos, bp, 3);
    if (this.prog.a.aCol !== undefined) {
      gl.bindBuffer(gl.ARRAY_BUFFER, bc); gl.enableVertexAttribArray(this.prog.a.aCol);
      gl.vertexAttribPointer(this.prog.a.aCol, 4, gl.UNSIGNED_BYTE, true, 0, 0);
    }
    attrib(gl, this.prog.a.aRnd, br, 4);
    attrib(gl, this.prog.a.aLoss, this.lossBuf, 2);
    this.order = new Uint32Array(n);
    for (let i = 0; i < n; i++) this.order[i] = i;
    this.idxBuf = buffer(gl, this.order, gl.ELEMENT_ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    gl.bindVertexArray(null);
    this.bufs = [bp, bc, br, this.lossBuf];
    this.pos = pos; this.n = n; this.dist = new Float32Array(n); this.lastKey = '';
  }

  get isTrichrome() { return this.channels === 3; }

  /** Carte de perte (0 = intact, 1 = très abîmé), à la taille de l'image affichée. */
  setLoss(m: LossMap | null) {
    if (!this.lossBuf) return;
    const a = this.lossAttr;
    for (let j = 0; j < this.n; j++) {
      if (!m) { a[j * 2] = 0; continue; }
      const u = (this.pos[j * 3] + this.halfW) / (2 * this.halfW), v = (this.halfH - this.pos[j * 3 + 1]) / (2 * this.halfH);
      a[j * 2] = m.data[Math.min(m.height - 1, Math.floor(v * m.height)) * m.width + Math.min(m.width - 1, Math.floor(u * m.width))];
    }
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lossBuf); gl.bufferData(gl.ARRAY_BUFFER, a, gl.DYNAMIC_DRAW);
    this.lastKey = '';
  }

  private resort(view: Mat4, look: SplatLook) {
    const fx = view[2], fy = view[6], fz = view[10];
    const key = `${fx.toFixed(3)},${fy.toFixed(3)},${fz.toFixed(3)},${look.height.toFixed(2)},${look.native.toFixed(2)},${this.sep.toFixed(2)}`;
    if (key === this.lastKey || !this.n) return;
    this.lastKey = key;
    const p = this.pos, l = this.lossAttr, d = this.dist, H = look.height, m = look.native;
    for (let i = 0; i < this.n; i++) {
      let z = (1 - m) * (p[i * 3 + 2] - 0.5) * H + m * l[i * 2] * H * 1.3;
      if (l[i * 2 + 1] >= 0) z += (l[i * 2 + 1] - 1) * this.sep;
      d[i] = -(fx * p[i * 3] + fy * p[i * 3 + 1] + fz * z);
    }
    sortBackToFront(d, this.order);
    const gl = this.gl;
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.idxBuf);
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.order);
  }

  draw(proj: Mat4, view: Mat4, viewportH: number, look: SplatLook, time: number) {
    if (!this.n || !this.vao) return;
    const { gl, prog } = this;
    const additive = this.channels === 3;
    gl.bindVertexArray(this.vao);
    if (!additive) this.resort(view, look);
    gl.useProgram(prog.program);
    const u = prog.u;
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform2fv(u.uAxis, this.axis);
    gl.uniform1f(u.uNative, look.native);
    gl.uniform1f(u.uHeight, look.height);
    gl.uniform1f(u.uSpacing, this.spacing);
    gl.uniform1f(u.uSize, look.size);
    gl.uniform1f(u.uSoft, look.soft);
    gl.uniform1f(u.uJitter, look.jitter);
    gl.uniform1f(u.uBreath, look.breath);
    gl.uniform1f(u.uAniso, look.aniso); gl.uniform1f(u.uShape, ['points', 'fins', 'longs', 'hachures', 'libres'].indexOf(look.forme ?? 'points'));
    gl.uniform1f(u.uDrift, look.drift);
    gl.uniform1f(u.uSep, this.sep);
    gl.uniform1f(u.uViewportH, viewportH);
    gl.uniform1f(u.uAppear, this.appear);
    gl.uniform1f(u.uReveal, this.reveal);
    gl.uniform1f(u.uHalfW, this.halfW); gl.uniform1f(u.uHalfH, this.halfH);
    gl.uniform1f(u.uMaxPoint, this.maxPoint);
    gl.uniform1f(u.uTime, time); gl.uniform1f(u.uGold, this.gold); gl.uniform1f(u.uSheen, this.sheen); bindGold(gl, u); gl.uniform1f(u.uEdgeZ, this.edgeZ); gl.uniform4fv(u.uScreen, this.screen);
    if (this.depthTest) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(false); } else gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    // trichromie : les trois passages s'additionnent (comme trois projections superposées)
    if (additive) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawElements(gl.POINTS, this.n, gl.UNSIGNED_INT, 0);
    gl.disable(gl.BLEND); gl.depthMask(true);
    gl.bindVertexArray(null);
  }
}
