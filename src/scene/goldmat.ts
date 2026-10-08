/**
 * La matière or : un fragment de la vraie photo du disque (or brossé, stries, reflets jaune-olive),
 * au lieu d'un or calculé. Chargée une fois, partagée par les splats et la plaque.
 * Dans les shaders : `discGold(l, st)` — l = luminance 0–1 de l'image, st = position sur l'image.
 */
const SRC = '/disque/matiere-or.jpg';
let img: HTMLImageElement | null = null;
const cache = new WeakMap<WebGL2RenderingContext, WebGLTexture>();

function load() {
  if (img) return;
  img = new Image(); img.decoding = 'async'; img.src = SRC;
}

/** Oublie la texture d'un contexte perdu (elle sera recréée). */
export function forgetGold(gl: WebGL2RenderingContext) { cache.delete(gl); }

/** Texture de la matière (null tant que la photo n'est pas chargée). */
export function goldTexture(gl: WebGL2RenderingContext): WebGLTexture | null {
  const t0 = cache.get(gl); if (t0) return t0;
  load();
  if (!img || !img.complete || !img.naturalWidth) return null;
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, img);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);   // pas de mipmaps : le shader ne lit que le niveau 0 (rendu identique)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.MIRRORED_REPEAT);   // en miroir : pas de couture
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.MIRRORED_REPEAT);
  cache.set(gl, t);
  return t;
}

/** Sens du brossage de l'or : il suit le sens des dégradations de l'image affichée ('v' : vertical, tel quel ; 'h' : tourné). */
let axis: 'v' | 'h' = 'v';
export function setGoldAxis(a: 'v' | 'h') { axis = a; }

/** Lie la matière à l'unité 2 et renseigne uMat / uMatOn / uMatRot. */
export function bindGold(gl: WebGL2RenderingContext, u: Record<string, WebGLUniformLocation | null>) {
  const t = goldTexture(gl);
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.uniform1i(u.uMat, 2); gl.uniform1f(u.uMatOn, t ? 1 : 0); if (u.uMatRot) gl.uniform1f(u.uMatRot, axis === 'h' ? 1 : 0);
  gl.activeTexture(gl.TEXTURE0);
}

/** GLSL : à placer après la fonction goldRamp (repli tant que la photo charge). */
export const GOLD_GLSL = /* glsl */`
uniform sampler2D uMat; uniform float uMatOn; uniform float uMatRot;
vec3 discGold(float l, vec2 st) {
  vec3 m = textureLod(uMat, (uMatRot > 0.5 ? st.yx : st) * 1.4, 0.0).rgb;            // l'or brossé de la photo (moyenne ≈ 0,5)
  vec3 g = m * (0.14 + 1.15 * pow(clamp(l, 0.0, 1.0), 0.9)); // sombre : olive profond · clair : l'or de la photo
  g = mix(g, vec3(dot(g, vec3(0.299, 0.587, 0.114))), 0.18);  // un peu éteint, comme sur la photo
  return mix(goldRamp(l), min(g, vec3(1.0)), uMatOn);
}`;
