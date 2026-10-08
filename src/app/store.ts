/**
 * Les gravures et les sons des visiteurs, stockés dans le navigateur (IndexedDB), sans serveur.
 * On garde la source réduite + le preset : la chaîne est déterministe, on peut donc tout recalculer.
 */
export interface Gravure {
  id: string;                  // DD-AAAAMMJJ-xxxx
  date: string;                // ISO
  titre: string;               // nom du fichier déposé
  preset: string;              // clé du preset
  mode: 'nb' | 'couleur';
  orientation: 0 | 1 | 2;
  passes: number;
  source: Blob;                // image d'origine, réduite (JPEG ≤ 1600 px)
  decoded: Blob;               // image décodée (PNG, orientation d'affichage)
  thumb: Blob;                 // vignette (JPEG 480 px)
  loss?: { data: Float32Array; width: number; height: number }; // carte de perte mesurée (avant/après la chaîne)
  chain?: number;              // version de la chaîne (3 : Barry 2017, contraste étendu) ; absente ou ancienne = à refaire
  block?: ArrayBuffer;         // (versions précédentes) signal [passage][trace][400], int16
}

const DB = 'deaddrop-spatialbox', STORE = 'gravures';

/** Une seule connexion par base, gardée ouverte (au lieu d'une nouvelle à chaque lecture/écriture). */
function cached(f: () => Promise<IDBDatabase>): () => Promise<IDBDatabase> {
  let p: Promise<IDBDatabase> | null = null;
  return () => (p ??= f().catch((e) => { p = null; throw e; }));
}
/** Une opération : terminée seulement quand la transaction est validée (une écriture annulée, faute de place, est signalée). */
function run<T>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode), req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = () => reject(t.error ?? req.error);
    t.onabort = () => reject(t.error ?? new Error('transaction annulée'));
  });
}

const open = cached(() => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
});
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => run(db, STORE, mode, fn));
}

export async function listGravures(): Promise<Gravure[]> {
  try { return ((await tx('readonly', (s) => s.getAll())) as Gravure[]).sort((a, b) => a.date.localeCompare(b.date)); }
  catch (e) { console.warn('IndexedDB indisponible', e); return []; }
}
export const saveGravure = (g: Gravure) => tx('readwrite', (s) => s.put(g));

/** Identifiant propre aux gravures : DD-AAAAMMJJ-xxxx (4 caractères aléatoires). */
export function newGravureId(d = new Date()): string {
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '');
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = ''; for (let i = 0; i < 4; i++) s += abc[Math.floor(Math.random() * abc.length)];
  return `DD-${ymd}-${s}`;
}

// ─── les sons des visiteurs (une base à part, pour ne pas toucher aux gravures) ───────────
export interface Son { id: string; date: string; titre: string; blob: Blob }
const DB_SONS = 'deaddrop-sons', STORE_SONS = 'sons';
const openSons = cached(() => {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_SONS, 1);
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE_SONS)) r.result.createObjectStore(STORE_SONS, { keyPath: 'id' }); };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
});
function txSons<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openSons().then((db) => run(db, STORE_SONS, mode, fn));
}
export async function listSons(): Promise<Son[]> {
  try { return ((await txSons('readonly', (s) => s.getAll())) as Son[]).sort((a, b) => a.date.localeCompare(b.date)); }
  catch (e) { console.warn('IndexedDB (sons) indisponible', e); return []; }
}
export const saveSon = (s: Son) => txSons('readwrite', (st) => st.put(s));
