/**
 * Images en lignes gravées.
 * Une image n'est plus un nuage de points mais une nappe de lignes, tracées dans le sens des
 * traces du signal (comme le sillon du disque, comme le balayage de 1977). Chaque ligne se
 * soulève selon la lumière de l'image : on lit l'image par son relief.
 *
 * Une même feuille sert partout :
 * - à plat dans la visionneuse ;
 * - sur la couronne du disque, à l'accueil : plate au centre, elle s'enroule autour du disque
 *   en allant vers les côtés (`bend`), avec son cadre et son titre (mode « cadre »).
 * Format rigide : toutes les images tiennent dans un cadre 540 × 364 (le format d'une image du
 * disque) ; une image en hauteur y entre entière, avec des marges noires — rien n'est coupé.
 */
import { createProgram, buffer, type Program } from './gl.ts';
import type { Mat4 } from './math.ts';
import { GOLD_GLSL, bindGold } from './goldmat.ts';

export const FRAME_ASPECT = 540 / 364;

const VS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 aUV;
uniform mat4 uProj, uView;
uniform sampler2D uImg, uLoss;
uniform vec4 uRect;          // rectangle local (x0, y0, x1, y1) couvert par u, v
uniform vec2 uImgHalf;       // demi-taille de l'image (unités locales)
uniform float uImgAspect;    // largeur / hauteur de l'image réelle
uniform vec3 uCenter;        // centre de l'image
uniform float uYaw;          // orientation de la feuille à plat
uniform float uRingR, uRingA, uBend; // couronne : rayon, angle du centre, enroulement 0–1
uniform float uRelief, uLift, uLossAmt, uTime;
uniform int uMode;           // 0 : lignes ; 1 : cadre
uniform int uAxis;           // 0 : lignes verticales ; 1 : horizontales
out vec3 vCol; out float vA; out vec2 vUV;

vec2 imgUV(vec2 p) {          // position locale → coordonnées dans l'image (contenue, centrée)
  vec2 q = p / uImgHalf * 0.5;          // −0.5 … 0.5 dans le cadre image
  float F = uImgHalf.x / uImgHalf.y;
  vec2 fit = uImgAspect > F ? vec2(1.0, F / uImgAspect) : vec2(uImgAspect / F, 1.0);
  return vec2(q.x / fit.x + 0.5, 0.5 - q.y / fit.y);
}

void main() {
  vec2 p = mix(uRect.xy, uRect.zw, aUV);
  vUV = vec2(aUV.x, 1.0 - aUV.y);
  float lum = 0.0, mask = 0.0, loss = 0.0; vec3 col = vec3(0.0);
  if (uMode == 0) {
    vec2 t = imgUV(p);
    mask = step(0.0, t.x) * step(t.x, 1.0) * step(0.0, t.y) * step(t.y, 1.0);
    col = textureLod(uImg, clamp(t, 0.0, 1.0), 0.0).rgb * mask;
    lum = dot(col, vec3(0.299, 0.587, 0.114));
    loss = uLossAmt > 0.0 ? textureLod(uLoss, clamp(t, 0.0, 1.0), 0.0).r * mask : 0.0;
    // les lignes abîmées glissent de côté (le long de la trace voisine)
    float h = fract(sin(dot(floor(aUV * vec2(400.0, 60.0)), vec2(12.9898, 78.233))) * 43758.5453);
    if (uAxis == 0) p.x += (h - 0.5) * loss * uLossAmt * 0.04; else p.y += (h - 0.5) * loss * uLossAmt * 0.04;
  }
  // à plat
  float cy = cos(uYaw), sy = sin(uYaw);
  vec3 nFlat = vec3(sy, 0.0, cy);
  vec3 pFlat = uCenter + vec3(cy, 0.0, -sy) * p.x + vec3(0.0, p.y, 0.0);
  // enroulé sur la couronne
  float ang = uRingA + p.x / uRingR;
  vec3 nRing = vec3(-sin(ang), 0.0, cos(ang));
  vec3 pRing = vec3(uRingR * sin(ang), uCenter.y + p.y, -uRingR * cos(ang));
  vec3 n = normalize(mix(nFlat, nRing, uBend));
  vec3 pos = mix(pFlat, pRing, uBend);
  if (uMode == 0) pos += n * (lum * uRelief + uLift);
  vCol = col; vA = mask * (1.0 - 0.55 * loss);
  gl_Position = uProj * uView * vec4(pos, 1.0);
}`;

const FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec3 vCol; in float vA; in vec2 vUV;
uniform sampler2D uFrame;
uniform int uMode;
uniform float uAlpha, uGain, uGold;
out vec4 o;
vec3 goldRamp(float l) {
  float lg = pow(clamp(l, 0.0, 1.0), 0.8);
  vec3 g = mix(vec3(0.16, 0.10, 0.03), vec3(0.62, 0.46, 0.05), smoothstep(0.0, 0.6, lg));
  return mix(g, vec3(0.95, 0.88, 0.55), smoothstep(0.6, 1.0, lg));
}
${GOLD_GLSL}
void main() {
  if (uMode == 1) { vec4 f = texture(uFrame, vUV); o = vec4(f.rgb, f.a * uAlpha); return; }
  float l = dot(vCol, vec3(0.299, 0.587, 0.114));
  vec3 gold = discGold(l, vUV);
  vec3 c = mix(vec3(l), gold, uGold) * (0.95 + 1.3 * uGain * l) + vec3(0.05);   // un fond de ligne : le sillon reste visible dans le noir
  o = vec4(c, uAlpha * mix(0.22, 1.0, smoothstep(0.03, 0.55, l)) * (0.55 + 0.45 * vA));
}`;

/** Grille de lignes partagée (par taille). */
interface Grid { vbo: WebGLBuffer; vIdx: WebGLBuffer; hIdx: WebGLBuffer; tIdx: WebGLBuffer; nv: number; nh: number; nt: number }

export interface SheetParams {
  proj: Mat4; view: Mat4;
  img: WebGLTexture; imgAspect: number;
  loss?: WebGLTexture | null; lossAmt?: number;
  frame?: WebGLTexture | null;           // texture du cadre (null : pas de cadre)
  W: number;                             // largeur de l'image (cadre image) en unités
  pad?: number; cap?: number;            // bord et bandeau du titre
  center: [number, number, number];
  yaw?: number; ringR?: number; ringA?: number; bend?: number;
  relief: number; alpha?: number; gain?: number;
  lines: number; axis: 'v' | 'h';
  time?: number;
  lineLift?: number;                     // décolle les lignes du cadre
  aspect?: number;                       // format de la feuille (par défaut 540/364)
  gold?: number;                         // 0 : gris · 1 : or du disque
}

export class LineSheet {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private grids = new Map<string, Grid>();
  private blank: WebGLTexture;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    this.blank = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, this.blank);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);   // texture complète : plus d'avertissement du navigateur
  }

  /** cols × rows sommets ; index pour lignes verticales, horizontales et triangles. */
  private grid(cols: number, rows: number): Grid {
    const key = cols + 'x' + rows;
    let g = this.grids.get(key);
    if (g) return g;
    const gl = this.gl;
    const uv = new Float32Array(cols * rows * 2);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const k = (j * cols + i) * 2; uv[k] = i / (cols - 1); uv[k + 1] = j / (rows - 1); }
    const v: number[] = [], h: number[] = [], t: number[] = [];
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows - 1; j++) v.push(j * cols + i, (j + 1) * cols + i);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols - 1; i++) h.push(j * cols + i, j * cols + i + 1);
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i; t.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols); }
    const I = Uint32Array;
    g = { vbo: buffer(gl, uv), vIdx: buffer(gl, new I(v), gl.ELEMENT_ARRAY_BUFFER), hIdx: buffer(gl, new I(h), gl.ELEMENT_ARRAY_BUFFER), tIdx: buffer(gl, new I(t), gl.ELEMENT_ARRAY_BUFFER), nv: v.length, nh: h.length, nt: t.length };
    this.grids.set(key, g);
    return g;
  }

  draw(p: SheetParams) {
    const gl = this.gl, u = this.prog.u;
    const FA = p.aspect ?? FRAME_ASPECT;
    const W = p.W, H = W / FA, pad = p.pad ?? 0, cap = p.cap ?? 0;
    gl.useProgram(this.prog.program);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.uProj, false, p.proj); gl.uniformMatrix4fv(u.uView, false, p.view);
    gl.uniform2f(u.uImgHalf, W / 2, H / 2); gl.uniform1f(u.uImgAspect, p.imgAspect);
    gl.uniform3fv(u.uCenter, p.center); gl.uniform1f(u.uYaw, p.yaw ?? 0);
    gl.uniform1f(u.uRingR, p.ringR ?? 1); gl.uniform1f(u.uRingA, p.ringA ?? 0); gl.uniform1f(u.uBend, p.bend ?? 0);
    gl.uniform1f(u.uRelief, p.relief); gl.uniform1f(u.uLossAmt, p.loss ? (p.lossAmt ?? 1) : 0); gl.uniform1f(u.uTime, p.time ?? 0); gl.uniform1f(u.uLift, p.lineLift ?? 0);
    gl.uniform1f(u.uAlpha, p.alpha ?? 1); gl.uniform1f(u.uGain, p.gain ?? 0.9); gl.uniform1f(u.uGold, p.gold ?? 1); bindGold(gl, u);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, p.img); gl.uniform1i(u.uImg, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, p.loss ?? this.blank); gl.uniform1i(u.uLoss, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, p.frame ?? this.blank); gl.uniform1i(u.uFrame, 2);
    const loc = this.prog.a.aUV;

    // 1. le cadre (papier + titre), légèrement derrière les lignes
    if (p.frame) {
      const g = this.grid(24, 6);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
      gl.uniform1i(u.uMode, 1);
      gl.uniform4f(u.uRect, -W / 2 - pad, -H / 2 - pad - cap, W / 2 + pad, H / 2 + pad);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, g.tIdx);
      gl.drawElements(gl.TRIANGLES, g.nt, gl.UNSIGNED_INT, 0);
    }
    // 2. les lignes
    // même écart entre lignes dans les deux sens ; `lines` = nombre de lignes sur la largeur
    const n = Math.max(8, Math.round(p.lines)), segs = Math.max(24, Math.round(n * 0.6));
    const vert = p.axis === 'v';
    const g = vert ? this.grid(n, Math.round(segs / FA)) : this.grid(segs, Math.round(n / FA));
    gl.bindBuffer(gl.ARRAY_BUFFER, g.vbo); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.uniform1i(u.uMode, 0); gl.uniform1i(u.uAxis, vert ? 0 : 1);
    gl.uniform4f(u.uRect, -W / 2, -H / 2, W / 2, H / 2);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, vert ? g.vIdx : g.hIdx);
    gl.drawElements(gl.LINES, vert ? g.nv : g.nh, gl.UNSIGNED_INT, 0);
  }

  /** Point local (x, y) d'une feuille → monde (même calcul que le shader, sans relief). */
  static place(x: number, y: number, c: [number, number, number], yaw: number, ringR: number, ringA: number, bend: number): [number, number, number] {
    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fx = c[0] + cy * x, fy = c[1] + y, fz = c[2] - sy * x;
    const ang = ringA + x / ringR;
    const rx = ringR * Math.sin(ang), rz = -ringR * Math.cos(ang);
    return [fx + (rx - fx) * bend, fy, fz + (rz - fz) * bend];
  }
}
