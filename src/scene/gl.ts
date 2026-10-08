/** Utilitaires WebGL2 : programmes, tampons, textures. Aucune dépendance. */

export function createContext(canvas: HTMLCanvasElement, transparent = false): WebGL2RenderingContext | null {
  // transparent : le canevas laisse voir la page derrière (couleurs prémultipliées)
  const gl = canvas.getContext('webgl2', { antialias: true, alpha: transparent, premultipliedAlpha: transparent, powerPreference: 'high-performance' });
  return gl;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    const numbered = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)} ${l}`).join('\n');
    throw new Error(`Shader : ${log}\n${numbered}`);
  }
  return s;
}

export interface Program {
  program: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  a: Record<string, number>;
}

export function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string): Program {
  const p = gl.createProgram()!;
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('Programme : ' + gl.getProgramInfoLog(p));
  const u: Program['u'] = {}, a: Program['a'] = {};
  const nu = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < nu; i++) { const info = gl.getActiveUniform(p, i)!; u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name); }
  const na = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES) as number;
  for (let i = 0; i < na; i++) { const info = gl.getActiveAttrib(p, i)!; a[info.name] = gl.getAttribLocation(p, info.name); }
  return { program: p, u, a };
}

export function buffer(gl: WebGL2RenderingContext, data: BufferSource, target: number = gl.ARRAY_BUFFER, usage: number = gl.STATIC_DRAW): WebGLBuffer {
  const b = gl.createBuffer()!;
  gl.bindBuffer(target, b);
  gl.bufferData(target, data, usage);
  return b;
}

export function attrib(gl: WebGL2RenderingContext, loc: number | undefined, buf: WebGLBuffer, size: number, divisor = 0, type: number = gl.FLOAT) {
  if (loc === undefined || loc < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, size, type, false, 0, 0);
  gl.vertexAttribDivisor(loc, divisor);
}

export function textureFromSource(gl: WebGL2RenderingContext, src: TexImageSource, opts: { mipmap?: boolean; flipY?: boolean } = {}): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, opts.flipY ?? false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, src);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  const mip = opts.mipmap ?? true;
  if (mip) gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
