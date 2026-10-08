/**
 * Le tirage en volume : une plaque fine, au format du tirage (cadre + bandeau du titre).
 *
 * - Toujours : le cadre est une feuille mince en relief léger (papier, grain), le titre y est
 *   gravé en creux. Le cadre fait partie du volume, comme sur l'accueil.
 * - Option « Matière » : la fenêtre de l'image devient elle aussi plaque — une tôle mince qui
 *   épouse le relief de l'image (dos parallèle à la face, pas de bloc), creusée de sillons fins
 *   dans le sens des traces, comme le disque. Sans l'option, la fenêtre est vide : les splats
 *   y flottent.
 * Coût : une seule grille (~50 000 sommets), hauteurs lues dans la texture sur la carte graphique,
 * sillons, gravure du titre et normales calculés par pixel.
 */
import { createProgram, buffer, textureFromSource, type Program } from './gl.ts';
import type { Mat4 } from './math.ts';
import { GOLD_GLSL, bindGold } from './goldmat.ts';

const VS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec3 aG;                 // u, v sur la plaque (0–1), bord (1 = arête arrière)
uniform mat4 uProj, uView;
uniform vec4 uScreen;
uniform sampler2D uImg;
uniform vec4 uPlate;        // x0, y0 (haut gauche), largeur, hauteur — en unités de la scène
uniform vec4 uWin;          // fenêtre de l'image, en uv de plaque (u0, v0, u1, v1)
uniform float uHeight, uThin, uAppear, uFrameZ;
uniform int uImageOn;
uniform int uBackPass;       // 1 : le dos plat de la plaque
uniform float uMinL;         // luminance la plus sombre de l'image (le dos se pose juste dessous)
out vec2 vUV; out vec3 vPos; out float vSide; out vec3 vN;
float lum(vec2 uv) { return dot(textureLod(uImg, uv, 1.5).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 uv = aG.xy;
  vec2 iuv = (uv - uWin.xy) / (uWin.zw - uWin.xy);
  bool inImg = all(greaterThanEqual(iuv, vec2(0.0))) && all(lessThanEqual(iuv, vec2(1.0)));
  // une plaque fine : le relief s'élève depuis un plan de base et retombe à zéro sur les bords,
  // si bien que la tranche n'a que l'épaisseur de la plaque ; le dos est plat, juste derrière
  float base = (uMinL - 0.5) * uHeight * uAppear - 0.012;
  float top = base;
  if (inImg && uImageOn == 1) {
    float edge = smoothstep(0.0, 0.035, min(min(iuv.x, 1.0 - iuv.x), min(iuv.y, 1.0 - iuv.y)));
    top = base + max(0.0, (lum(iuv) - 0.5) * uHeight * uAppear - 0.012 - base) * edge;
  }
  float back = base - uThin;
  float z = top - aG.z * uThin;            // le dos suit la face : une plaque, pas un bloc (pas de dos plat)
  vec3 p = vec3(uPlate.x + uv.x * uPlate.z, uPlate.y - uv.y * uPlate.w, z);
  // coins arrondis dans la géométrie elle-même : la face, la tranche et le dos restent fermés
  vec2 hp = uPlate.zw * 0.5, C = vec2(uPlate.x + hp.x, uPlate.y - hp.y);
  float rc = 0.05 * min(hp.x, hp.y);
  vec2 q = abs(p.xy - C) - (hp - rc);
  vec2 sg = sign(p.xy - C + 1e-6);
  if (q.x > 0.0 && q.y > 0.0 && length(q) > rc) p.xy = C + sg * (hp - rc + normalize(q) * rc);
  // normale lisse de la tranche : vers l'extérieur (arrondie dans les coins)
  vec2 dd = (p.xy - C) / hp;
  vN = (q.x > 0.0 && q.y > 0.0) ? vec3(sg * normalize(q), 0.0) : (abs(dd.x) > abs(dd.y) ? vec3(sg.x, 0.0, 0.0) : vec3(0.0, sg.y, 0.0));
  vUV = uv; vPos = p; vSide = uBackPass == 1 ? 2.0 : aG.z;
  gl_Position = uProj * uView * vec4(p, 1.0);
  gl_Position.xy = gl_Position.xy * uScreen.xy + uScreen.zw * gl_Position.w;
}`;

const FS = /* glsl */`#version 300 es
precision highp float;
precision highp int;
in vec2 vUV; in vec3 vPos; in float vSide; in vec3 vN;
uniform sampler2D uImg, uFrame;
uniform float uLod;
uniform vec4 uPlate, uWin;
uniform vec2 uTexel, uFTexel;
uniform float uHeight, uGrooves, uDepth, uAppear, uAlphaK;
uniform int uAxis, uImageOn;
uniform float uGold;
uniform vec3 uEye;
out vec4 o;
vec3 goldRamp(float l) {           // teintes relevées sur la photo du disque (du sillon sombre au reflet)
  l = pow(clamp(l, 0.0, 1.0), 0.8);
  vec3 c = mix(vec3(0.16, 0.10, 0.03), vec3(0.43, 0.27, 0.03), smoothstep(0.0, 0.35, l));
  c = mix(c, vec3(0.62, 0.46, 0.05), smoothstep(0.35, 0.6, l));
  c = mix(c, vec3(0.80, 0.66, 0.14), smoothstep(0.6, 0.85, l));
  return mix(c, vec3(0.95, 0.88, 0.55), smoothstep(0.85, 1.0, l));
}
${GOLD_GLSL}
float lum(vec2 uv) { return dot(textureLod(uImg, uv, uLod).rgb, vec3(0.299, 0.587, 0.114)); }
float flum(vec2 uv) { return dot(texture(uFrame, uv).rgb, vec3(0.299, 0.587, 0.114)); }
void main() {
  vec2 iuv = (vUV - uWin.xy) / (uWin.zw - uWin.xy);
  bool inImg = all(greaterThanEqual(iuv, vec2(0.0))) && all(lessThanEqual(iuv, vec2(1.0)));
  if (inImg && uImageOn == 0 && vSide < 0.001) discard;   // fenêtre vide : les splats flottent

  vec3 col, n;
  float shininess = 18.0, specK = 0.12;
  if (vSide > 1.5) {
    n = vec3(0.0, 0.0, -1.0);                              // le dos : plat, de la même matière
    col = mix(vec3(0.42), discGold(0.42, vUV), uGold);
  } else if (vSide > 0.001) {
    n = normalize(vN + vec3(0.0, 0.0, 0.15));
    // la tranche : coupée dans la matière — sombre, mate, grain brut et stries de découpe
    float gr = fract(sin(dot(floor(vPos.xy * 900.0), vec2(12.9898, 78.233))) * 43758.5453);
    col = mix(vec3(0.2), discGold(0.16, vUV * 3.0), uGold) * (0.4 + 0.14 * gr);
    col *= 0.82 + 0.18 * sin(vPos.z * 2600.0 + gr * 2.0);
    shininess = 8.0; specK = 0.04;
  } else if (inImg) {
    col = texture(uImg, iuv).rgb;
    { float l0 = dot(col, vec3(0.299, 0.587, 0.114));   // l'or du disque
      col = mix(vec3(l0), discGold(l0, vUV), uGold); }
    vec2 e = uTexel * 2.0 * exp2(uLod - 1.0), sz = (uWin.zw - uWin.xy) * uPlate.zw;
    float dx = (lum(iuv + vec2(e.x, 0.0)) - lum(iuv - vec2(e.x, 0.0))) * uHeight / (4.0 * e.x * sz.x * 0.5);
    float dy = (lum(iuv - vec2(0.0, e.y)) - lum(iuv + vec2(0.0, e.y))) * uHeight / (4.0 * e.y * sz.y * 0.5);
    // sillons gravés le long des traces, atténués quand ils deviennent trop fins pour l'écran
    float t = (uAxis == 0 ? iuv.x : iuv.y) * uGrooves, w = fwidth(t);
    float fade = 1.0 - smoothstep(0.35, 0.7, w);
    float g = cos(t * 6.2831853) * uDepth * fade * (0.35 + 0.65 * lum(iuv));
    if (uAxis == 0) dx += g; else dy += g;
    n = normalize(vec3(-dx, -dy, 1.0));
    col *= 0.9 + 0.1 * fade * sin(t * 6.2831853);
    shininess = 60.0; specK = 0.7;
  } else {
    // le cadre : papier, grain, titre gravé en creux
    col = texture(uFrame, vUV).rgb;
    vec2 e = uFTexel * 1.5;
    float dx = (flum(vUV + vec2(e.x, 0.0)) - flum(vUV - vec2(e.x, 0.0))) * 0.9;
    float dy = (flum(vUV - vec2(0.0, e.y)) - flum(vUV + vec2(0.0, e.y))) * 0.9;
    n = normalize(vec3(dx, dy, 1.0));                      // signe inversé : le sombre est un creux
  }
  if (!gl_FrontFacing && vSide < 1.5) { o = vec4(0.0, 0.0, 0.0, uAppear * uAlphaK); return; }
  if (vSide > 1.5 && dot(n, normalize(uEye - vPos)) < 0.0) n = -n;
  vec3 L = normalize(vec3(-0.55, 0.65, 0.55)), V = normalize(uEye - vPos), H = normalize(L + V);
  float dif = max(dot(n, L), 0.0), amb = 0.34 + 0.16 * abs(n.z);
  float spec = pow(max(dot(n, H), 0.0), shininess) * specK;
  float A = uAppear * uAlphaK;   // couleurs prémultipliées
  o = vec4((col * (amb + 0.9 * dif) + vec3(1.0, 0.94, 0.8) * spec) * A, A);
}`;

export interface PlateLook { height: number; thin: number; grooves: number; depth: number; imageOn: boolean; alpha?: number; gold?: number; smooth?: boolean }

/** Proportions du tirage (comme sur l'accueil) : bord et bandeau, en fraction de la hauteur de l'image. */
export const PAD = 0, CAP = 0;   // plus de cadre : l'image seule

export class MatterPlate {
  private gl: WebGL2RenderingContext;
  private prog: Program;
  private vao: WebGLVertexArrayObject;
  private vbo: WebGLBuffer; private ibo: WebGLBuffer; private n = 0;
  private tex: WebGLTexture | null = null; private texSize: [number, number] = [1, 1];
  private frame: WebGLTexture | null = null;
  private noir: WebGLTexture | null = null;
  /** Texture noire 1×1 (même valeur que « pas de texture ») : évite les avertissements du navigateur à chaque image. */
  private blank() {
    if (this.noir) return this.noir;
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    return (this.noir = t);
  } private frameSize: [number, number] = [1, 1];
  private frameKey = '';

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = createProgram(gl, VS, FS);
    this.vao = gl.createVertexArray()!;
    // grille avec un anneau de bord : l'anneau descend d'une épaisseur et forme l'arête
    const C = 300, R = 240, cols = C + 2, rows = R + 2;
    const g = new Float32Array(cols * rows * 3);
    for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
      const k = (j * cols + i) * 3;
      g[k] = Math.min(1, Math.max(0, (i - 1) / (C - 1)));
      g[k + 1] = Math.min(1, Math.max(0, (j - 1) / (R - 1)));
      g[k + 2] = i === 0 || j === 0 || i === cols - 1 || j === rows - 1 ? 1 : 0;
    }
    const idx: number[] = [];
    for (let j = 0; j < rows - 1; j++) for (let i = 0; i < cols - 1; i++) { const a = j * cols + i; idx.push(a, a + cols, a + 1, a + 1, a + cols, a + cols + 1); }
    this.vbo = buffer(gl, g); this.ibo = buffer(gl, new Uint32Array(idx), gl.ELEMENT_ARRAY_BUFFER); this.n = idx.length;
  }

  setImage(src: CanvasImageSource & { width: number; height: number }) {
    if (this.tex) this.gl.deleteTexture(this.tex);
    this.tex = textureFromSource(this.gl, src as TexImageSource, { mipmap: true });
    this.texSize = [src.width, src.height];
    // la valeur la plus sombre de l'image (2 % des points) : le dos plat se pose juste dessous
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(src, 0, 0, 64, 64);
    const d = g.getImageData(0, 0, 64, 64).data, L: number[] = [];
    for (let i = 0; i < d.length; i += 4) L.push((0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255);
    L.sort((a, b) => a - b); this.minL = L[Math.floor(L.length * 0.02)];
  }
  minL = 0;

  /** Papier du cadre + titre, à la taille du tirage. */
  setFrame(title: string, mine: boolean, imgAspect: number) {
    const key = title + '|' + mine + '|' + imgAspect.toFixed(3);
    if (key === this.frameKey) return;
    this.frameKey = key;
    const ih = 1, iw = imgAspect, W = iw + 2 * PAD, H = ih + PAD + CAP + PAD;
    const k = 1400 / Math.max(W, H), c = document.createElement('canvas');
    c.width = Math.round(W * k); c.height = Math.round(H * k);
    const g = c.getContext('2d')!;
    const paper = g.createLinearGradient(0, 0, c.width * 0.3, c.height);
    if (mine) { paper.addColorStop(0, '#f3e2b4'); paper.addColorStop(1, '#d4b56c'); } else { paper.addColorStop(0, '#f1ece1'); paper.addColorStop(1, '#ddd6c6'); }
    g.fillStyle = paper; g.fillRect(0, 0, c.width, c.height);
    const id = g.getImageData(0, 0, c.width, c.height), d = id.data;
    let s = 7; for (let i = 0; i < d.length; i += 4) { s = (s * 16807) % 2147483647; const nn = (s / 2147483647 - 0.5) * 9; d[i] += nn; d[i + 1] += nn; d[i + 2] += nn; }
    g.putImageData(id, 0, 0);
    g.fillStyle = mine ? '#4a3712' : '#3b352a';
    g.font = `${Math.round(CAP * k * 0.3)}px "Steps Mono", ui-monospace, monospace`;
    g.textBaseline = 'middle';
    let t = title; while (g.measureText(t).width > (iw) * k && t.length > 4) t = t.slice(0, -2);
    if (t !== title) t = t.slice(0, -1) + '…';
    g.fillText(t, PAD * k, (PAD + ih + CAP * 0.5) * k);
    if (this.frame) this.gl.deleteTexture(this.frame);
    this.frame = textureFromSource(this.gl, c, { mipmap: true });
    this.frameSize = [c.width, c.height];
  }

  /** `half` : demi-taille de l'image dans la scène (celle des splats). */
  screen: [number, number, number, number] = [1, 1, 0, 0];

  draw(proj: Mat4, view: Mat4, eye: [number, number, number], half: [number, number], axis: 'v' | 'h', look: PlateLook, appear: number) {
    if (!this.tex) return;
    const gl = this.gl, u = this.prog.u;
    const ih = 2 * half[1], pad = PAD * ih, cap = CAP * ih;
    const x0 = -half[0] - pad, y0 = half[1] + pad, PW = 2 * half[0] + 2 * pad, PH = ih + 2 * pad + cap;
    gl.useProgram(this.prog.program); gl.bindVertexArray(this.vao);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    const al = look.alpha ?? 1;
    if (al < 0.999) { gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); } else gl.disable(gl.BLEND);
    gl.uniformMatrix4fv(u.uProj, false, proj); gl.uniformMatrix4fv(u.uView, false, view); gl.uniform4fv(u.uScreen, this.screen);
    gl.uniform4f(u.uPlate, x0, y0, PW, PH);
    gl.uniform4f(u.uWin, pad / PW, pad / PH, (pad + 2 * half[0]) / PW, (pad + ih) / PH);
    gl.uniform2f(u.uTexel, 1 / this.texSize[0], 1 / this.texSize[1]); gl.uniform2f(u.uFTexel, 1 / this.frameSize[0], 1 / this.frameSize[1]);
    gl.uniform1f(u.uHeight, look.height); gl.uniform1f(u.uThin, look.thin); gl.uniform1f(u.uAppear, appear); gl.uniform1f(u.uAlphaK, al);
    gl.uniform1f(u.uFrameZ, -0.03 * ih);
    gl.uniform1f(u.uGrooves, look.grooves); gl.uniform1f(u.uDepth, look.depth);
    gl.uniform1i(u.uAxis, axis === 'v' ? 0 : 1); gl.uniform1i(u.uImageOn, look.imageOn ? 1 : 0); gl.uniform1f(u.uGold, look.gold ?? 1); bindGold(gl, u); gl.uniform1f(u.uMinL, this.minL); gl.uniform1f(u.uLod, look.smooth ? 2.6 : 1.0);
    gl.uniform3fv(u.uEye, eye);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.tex); gl.uniform1i(u.uImg, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.frame ?? this.blank()); gl.uniform1i(u.uFrame, 1);
    const loc = this.prog.a.aG;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    gl.uniform1i(u.uBackPass, 0);
    gl.drawElements(gl.TRIANGLES, this.n, gl.UNSIGNED_INT, 0);
  }
}
