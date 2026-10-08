/**
 * Types de la chaîne « Golden Record ».
 *
 * Vocabulaire (celui de Ron Barry, 2017) :
 * - trace : une colonne verticale de l'image, balayée de haut en bas, qui devient ≈ 8,3 ms de son ;
 * - trame (frame) : l'image vue par la machine, 540 traces × 364 pixels ;
 * - passage : une trame complète ; une image couleur = 3 passages (rouge, vert, bleu).
 */

/** Une trame en niveaux de gris, rangée trace par trace (dans l'ordre du temps). */
export interface Frame {
  /** nombre de traces (axe horizontal de l'image) */
  traces: number;
  /** nombre de pixels par trace (axe vertical de l'image) */
  pixels: number;
  /** luminance 0 (noir) → 1 (blanc) ; index = trace * pixels + pixel */
  data: Float32Array;
}

/** Image RVBA 8 bits, au format de ImageData (ligne par ligne). */
export interface RGBAImage {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Le son d'une image : un ou trois passages, à la suite. */
export interface Signal {
  sampleRate: number;
  samples: Float32Array;
  /** échantillon de début de chaque passage */
  passStarts: number[];
  /** nombre de traces par passage */
  traces: number;
  /** position théorique du creux de synchro de chaque trace (tous passages confondus) — sert aux effets et à l'affichage, jamais au décodeur */
  traceMarks: Int32Array;
}

export type Channel = 'r' | 'g' | 'b' | 'l';

export interface Toggle {
  enabled: boolean;
}
