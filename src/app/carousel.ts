/**
 * Le disque et ses images.
 * Le Golden Record est posé en bas de l'écran, vu en plongée, à moitié hors champ. Ses images
 * flottent au-dessus de lui, debout, reliées à lui par un fil. Tourner le disque (molette, glisser,
 * flèches) les fait défiler ; au repos il tourne lentement (vitesse de lecture).
 * Tout est en CSS 3D (perspective + preserve-3d) : pas de WebGL, léger, net.
 */
import { platine } from './audio.ts';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Aléa stable par image (disposition organique). */
const rnd = (i: number, k: number) => { const x = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return x - Math.floor(x); };

export interface CarouselItem { id: string; thumb: string; aspect: number; mine: boolean; label: string; title: string }

/** Photos du disque (public/disque/, voir CREDITS.md). */
/** Face visible : le disque lui-même (« verso » fourni, déjà découpé). */
const FACE = '/disque/verso-disque.jpg';
const IDLE_SPEED = 0.17;   // rotation de base un peu plus vive   // images par seconde, au repos
const TILT = 70;           // inclinaison du disque (degrés) : un peu plus à plat
/** Diamètre du disque pour que son bord passe exactement par les deux coins bas de l'écran
 *  (plan incliné de TILT°, perspective 1150 px, origine 50 % 30 %). */
function fitDisc(vw: number, vh: number, top: number) {
  const P = 1150, oy = vh * 0.3, a = TILT * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a);
  const reach = (D: number) => {                 // demi-largeur du disque à hauteur du bas de l'écran
    let best = 0;
    for (let k = 0; k <= 720; k++) {
      const t = (k / 720) * Math.PI, r = D / 2, x = r * Math.cos(t), y = r * Math.sin(t);   // moitié avant
      const z = y * sa, f = P / (P - z);
      if (z >= P - 1) continue;
      const Y = oy + (top + y * ca - oy) * f;
      if (Y >= vh) best = Math.max(best, Math.abs(x * f));
    }
    return best;
  };
  let lo = vw * 0.3, hi = vw * 3;
  for (let it = 0; it < 30; it++) { const m = (lo + hi) / 2; if (reach(m) < vw / 2) lo = m; else hi = m; }
  return hi;
}
const CURVE = 1.6;        // courbe des images un peu plus ouverte que le disque : plus d'images à la fois
const PAD = 0, CAP = 0;   // plus de cadre ni de titre : l'image seule

export class DiscCarousel {
  private root: HTMLElement;
  private body: HTMLElement;
  private faces: HTMLCanvasElement[];
  private cards: HTMLElement[] = [];
  private threads: HTMLElement[] = [];
  private dots: HTMLElement[] = [];
  private items: CarouselItem[] = [];
  private pos = 0;
  private vel = 0;
  private target: number | null = null;
  private running = false;
  private last = performance.now();
  private geo = { vw: 0, vh: 0, D: 0, R: 0, H: 0, step: 0.2 };
  onOpen: (i: number) => void = () => {};

  constructor(root: HTMLElement, waiting = false) {
    this.root = root;
    if (waiting) { this.tiltNow = 90; root.style.setProperty('--rise', '0px'); this.waiting = true; document.body.classList.add('montee', 'sans-images'); }   /* en attente : de profil, déjà dessiné sous le cadre (--rise posé dans layout) */
    root.innerHTML = `
      <div class="plane">
        <div class="disc-edge"></div>
        <div class="disc-body">
          <canvas class="face recto"></canvas>
          <canvas class="face verso"></canvas>
        </div>
        <div class="disc-sheen"></div>
        <div class="shadows"></div>
      </div>
      <div class="plane plane-cartes"><div class="ring"></div></div>`;   // les images : un calque à part, toujours peint par-dessus les fils
    this.body = root.querySelector('.disc-body') as HTMLElement;
    this.faces = [...root.querySelectorAll('.face')] as HTMLCanvasElement[];
    this.loadFace(0, FACE);
    let rz = 0; window.addEventListener('resize', () => { if (!rz) rz = requestAnimationFrame(() => { rz = 0; this.layout(); }); });   // au plus une mise en page par image pendant le redimensionnement

    window.addEventListener('wheel', (e) => {
      if (this.root.hidden || document.body.classList.contains('viewing') || document.body.classList.contains('welcome') || (e.target as HTMLElement).closest('.settings')) return;
      e.preventDefault();
      const d = (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? -e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);   // glisser vers la droite : le disque tourne vers la droite
      this.target = null; this.vel += d * this.gain() * (d < 0 ? 0.55 : 1); // à rebours : le disque résiste
      // un gros coup de molette (pas un petit) : on change de station
      const now = performance.now();
      const fade = Math.exp(-(now - this.burstAt) / 350); this.burstAt = now;
      this.burst = this.burst * fade + Math.max(0, d); this.burstRev = this.burstRev * fade + Math.max(0, -d);
      if (this.burst > 800 && now - this.tunedAt > 1200) { this.tunedAt = now; this.burst = 0; platine.tune(); }              // dans le sens du disque : on change de morceau
      if (this.burstRev > 800 && now - this.tunedAt > 1200) { this.tunedAt = now; this.burstRev = 0; platine.scratch(); }   // à rebours : un scratch, le morceau continue
    }, { passive: false });

    let drag: { x: number; p: number; t: number; moved: boolean } | null = null;
    root.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, p: this.pos, t: performance.now(), moved: false }; this.target = null; this.vel = 0; });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (e.pointerType === 'mouse' && !e.buttons) { drag = null; return; }   // bouton relâché hors de la fenêtre : on lâche le disque
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 6) drag.moved = true;
      if (!drag.moved) return;
      const np = drag.p - dx / (this.geo.H * 1.7);
      const now = performance.now();
      this.vel = (np - this.pos) / Math.max(1, (now - drag.t) / 16.7) * 0.6; drag.t = now;
      this.pos = np;
    });
    window.addEventListener('pointercancel', () => { drag = null; });
    window.addEventListener('pointerup', () => {
      const moved = drag?.moved; drag = null;
      if (moved) { root.classList.add('dragged'); setTimeout(() => root.classList.remove('dragged'), 0); }
    });
    root.addEventListener('click', (e) => { if (root.classList.contains('dragged')) { e.stopPropagation(); e.preventDefault(); } }, true);
    this.layout();
  }

  setItems(items: CarouselItem[]) {
    this.items = items;
    const ring = this.root.querySelector('.ring') as HTMLElement, sh = this.root.querySelector('.shadows') as HTMLElement;
    ring.innerHTML = ''; sh.innerHTML = '';
    this.threads = items.map(() => { const s = document.createElement('div'); s.className = 'thread'; sh.append(s); return s; });
    this.dots = items.map(() => { const s = document.createElement('div'); s.className = 'anchor'; sh.append(s); return s; });
    this.cards = items.map((it, i) => {
      const b = document.createElement('button');
      b.className = 'card' + (it.mine ? ' mine' : '');
      b.style.setProperty('--a', String(it.aspect));
      b.setAttribute('aria-label', it.label);
      b.dataset.src = it.thumb;
      b.innerHTML = '<span class="pic"></span>';
      b.style.setProperty('--r1', rnd(i, 1).toFixed(3)); 
      b.addEventListener('click', () => this.onOpen(i));
      b.addEventListener('pointerenter', () => { this.hoverTo[i] = 1; });
      b.addEventListener('pointerleave', () => { this.hoverTo[i] = 0; });
      b.addEventListener('focus', () => { if (Math.abs(this.offset(i)) > 0.5) this.goTo(i); });
      ring.append(b);
      return b;
    });
    this.hover = items.map(() => 0); this.hoverTo = items.map(() => 0);
    this.layout();
    this.start();
  }

  goTo(i: number, instant = false) {
    if (!this.items.length) return;
    const t = this.pos + this.offset(i);
    if (instant || reduceMotion) { this.pos = t; this.target = null; } else this.target = t;
    this.vel = 0;
  }
  /** Sensibilité de la molette : plus douce qu'avant, et bien plus encore juste après la sortie d'une image (elle remonte en ~1,4 s). */
  private calmUntil = 0;
  calm(ms = 1400) { this.calmUntil = performance.now() + ms; }
  private gain() {
    const left = Math.max(0, this.calmUntil - performance.now()) / 1400;
    return 0.0009 * (1 - 0.8 * left * left);
  }
  get index() { const n = this.items.length; return n ? ((Math.round(-this.pos) % n) + n) % n : 0; }
  flash(i: number) { const c = this.cards[i]; if (!c) return; c.classList.remove('new'); void c.offsetWidth; c.classList.add('new'); }
  step(d: number) { const n = this.items.length; this.goTo(((Math.round(-this.pos) + d) % n + n) % n); }

  /** Écart (en « pas » moyens de la bande) entre l'image i et le centre. La bande avance d'un mouvement uniforme. */
  private offset(i: number) {
    const n = this.items.length; if (!n || !this.xs.length) return 0;
    const avg = this.xsLen / n;
    let d = (-this.xs[i] / avg - this.pos) % n; if (d > n / 2) d -= n; if (d < -n / 2) d += n;
    return d;
  }

  private layout() {
    const vw = innerWidth, vh = innerHeight;
    const portrait = vh > vw * 1.2;
    const top = portrait ? vh * 1.0 : vh * 1.1;
    const D = fitDisc(vw, vh, top);   // le disque touche pile les deux coins bas de l'écran
    const H = Math.round(Math.max(110, Math.min(vh * 0.31, vw * (portrait ? 0.46 : 0.265))));   // un peu plus petites : tout tient sous le titre
    const R = D / 2 * 0.8;
    const step = (H * 1.4 + H * 0.22) / R;   // rotation du disque par image ≈ écart moyen entre deux images
    this.geo = { vw, vh, D, R, H, step };
    if (this.items.length) this.computeBand();
    const s = this.root.style;
    s.setProperty('--D', D + 'px'); s.setProperty('--H', H + 'px'); s.setProperty('--pad', PAD + 'px'); s.setProperty('--cap', CAP + 'px');
    s.setProperty('--tilt', this.tiltNow + 'deg');
    if (this.waiting) s.setProperty('--rise', (D * 0.55).toFixed(1) + 'px');   // exactement là où la montée commencera : rien à recalculer au moment crucial
    for (const pl of this.root.querySelectorAll<HTMLElement>('.plane')) { pl.style.left = vw / 2 + 'px'; pl.style.top = top + 'px'; }
    this.planeTop = top;
    const br = document.querySelector('.brand')?.getBoundingClientRect();
    this.ceil = br && br.height ? br.bottom + 8 : 84;      // les images ne montent pas plus haut que le bas du titre
    for (let i = 0; i < this.faces.length; i++) this.drawFace(i);
  }

  /** Arrivée depuis l'accueil : le disque, de profil, bascule vers nous jusqu'à sa position,
   *  en tournant vite sur lui-même, puis ralentit tranquillement jusqu'à sa vitesse habituelle. */
  private tiltNow = TILT;
  private lastRate = -1; private burst = 0; private burstRev = 0; private burstAt = 0; private tunedAt = 0; private lastPos = 0;
  private tiltFrom = 0;
  private waiting = false;
  private boost = 0;
  arrive(spinDeg = 110) {
    if (reduceMotion) { this.waiting = false; this.tiltNow = TILT; this.root.style.setProperty('--rise', '0px'); this.layout(); document.body.classList.remove('montee', 'sans-images'); this.root.style.setProperty('--tilt', TILT + 'deg'); return; }
    this.waiting = false; this.tiltFrom = performance.now();
    // même vitesse de rotation propre que le petit disque à l'instant où il a disparu (comme si la caméra s'était juste déplacée)
    this.boost = Math.max(0, spinDeg * Math.PI / 180 / Math.max(1e-3, this.geo.step) - IDLE_SPEED);
  }
  start() { if (this.running) return; this.running = true; this.last = performance.now(); requestAnimationFrame(this.frame); }

  private frame = (now: number) => {
    if (!this.running) return;
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    if (!this.root.hidden) {
      if (this.target !== null) {
        const d = this.target - this.pos;
        this.pos += d * (1 - Math.pow(0.0005, dt));
        if (Math.abs(d) < 0.002) { this.pos = this.target; this.target = null; }
      } else {
        // inertie : lancé dans son sens, il file longtemps ; freiné ou tourné à l'envers, le moteur le ramène
        // plus fermement vers son allure (comme un plateau qu'on retient à la main), sans à-coup
        if (this.vel < 0) this.vel = Math.max(this.vel, -0.06);
        this.pos += this.vel; this.vel *= Math.pow(this.vel < 0 ? 0.008 : 0.04, dt);
        this.pos += this.boost * dt; this.boost *= Math.pow(0.45, dt);   // élan de l'accueil, qui s'éteint doucement
        if (!reduceMotion) this.pos += IDLE_SPEED * dt;   // rotation minimale constante (= lecture ×1), toujours
      }
      if (this.tiltFrom) {
        // arrivée : il est sur sa tranche, comme le petit disque à l'instant où il a disparu, et continue
        // le même basculement (même vitesse au départ) jusqu'à sa position, en ralentissant doucement
        // et il arrive par le bas, au même instant, dans le même élan
        const s = (now - this.tiltFrom) / 1000, tau = 0.6, k = Math.exp(-s / tau);
        this.tiltNow = 90 + (TILT - 90) * (1 - k);
        this.root.style.setProperty('--tilt', this.tiltNow.toFixed(2) + 'deg');
        this.root.style.setProperty('--rise', (this.geo.D * 0.55 * k).toFixed(1) + 'px');
        if (s > 0.9 && document.body.classList.contains('montee')) document.body.classList.remove('montee');   // puis images, fils, titre et boutons apparaissent
        if (s > 1.8 && document.body.classList.contains('sans-images')) document.body.classList.remove('sans-images');   // le disque est en place : les images apparaissent ensuite, en fondu
        if (s > 5) { this.tiltFrom = 0; this.tiltNow = TILT; this.root.style.setProperty('--tilt', TILT + 'deg'); this.root.style.setProperty('--rise', '0px'); }
      }
      // la musique suit la rotation : vitesse habituelle = lecture normale
      // la musique : ×1 dans une large marge (on peut faire défiler doucement sans rien changer) ;
      // vraiment lancé, elle accélère et monte ; retenu à rebours, elle ralentit et descend, comme sous la main
      const v = (this.pos - this.lastPos) / Math.max(dt, 1e-3); this.lastPos = this.pos;   // images/s, + = sens du disque
      const r = v >= 0 ? (v <= 4 ? 1 : 1 + 0.38 * Math.log2(v / 4)) : 1 - 0.3 * Math.max(0, -v - 0.4);
      const rr = Math.max(0.4, Math.min(2.4, r));
      if (!document.body.classList.contains('welcome') && Math.abs(rr - this.lastRate) > 0.002) { this.lastRate = rr; platine.setSpeed(rr); }   // seulement quand la vitesse change vraiment
      this.place(now / 1000);
    }
    requestAnimationFrame(this.frame);
  };

  /** Rangée de l'image (0 : basse, 1 : haute), stable. */
  private row(i: number) { return (i + (rnd(i, 6) < 0.22 ? 1 : 0)) % 2; }
  private xs: number[] = [];
  private planeTop = 0;
  private ceil = 84;
  private hover: number[] = [];
  private hoverTo: number[] = [];
  private hs: number[] = [];
  private ws: number[] = [];
  private xsLen = 1;
  /** Positions le long de la bande : deux rangées qui se chevauchent en largeur, jamais dans une même rangée. */
  private computeBand() {
    const n = this.items.length, H = this.geo.H, gap = H * 0.12;   // plus d'images à la fois
    // tailles harmonisées : même surface pour toutes les images, quel que soit leur format
    this.hs = this.items.map((it) => H * Math.sqrt(1.2 / (it.aspect || 1.5)));
    this.hs.forEach((h, i) => this.cards[i]?.style.setProperty('--ch', h.toFixed(1) + 'px'));
    const w = (i: number) => this.hs[i] * (this.items[i].aspect || 1.5);
    this.ws = this.items.map((_, i) => w(i));
    const end = [-Infinity, -Infinity];
    this.xs = new Array(n);
    let x = 0;
    for (let i = 0; i < n; i++) {
      const r = this.row(i), half = w(i) / 2;
      x = i === 0 ? 0 : Math.max(x + (w(i - 1) / 2 + half) * 0.46, end[r] + gap + half);   // jamais deux images serrées
      this.xs[i] = x; end[r] = x + half;
    }
    this.xsLen = Math.max(end[0], end[1]) + gap + w(0) / 2;
    this.geo.step = this.xsLen / n / this.geo.R;          // le disque tourne d'autant que la bande avance
  }

  /** Décalage d'une image depuis la courbe : le long de la normale à la courbure du disque (vers le haut
   *  et vers l'extérieur), si bien que sur les côtés les images partent vers les coins en suivant le disque.
   *  La rangée haute s'écarte juste assez pour ne jamais toucher les images basses voisines. */
  private offsetOf(i: number, xi: number, ct: number, Rb: number, L: number): [number, number] {
    const H = this.geo.H, gap = H * 0.14;
    const Rc = Rb * CURVE, curve = (x: number): [number, number] => [x, (-Rb + (x * x) / (2 * Rc)) * ct];
    const normal = (x: number): [number, number] => { const sl = (x * ct) / Rc, k = Math.hypot(sl, 1); return [sl / k, -1 / k]; };
    const low = (j: number) => H * (0.3 + 0.18 * rnd(j, 1));   // rangée basse : plus haut, moins sur le disque
    const ni = normal(xi);
    let d = this.row(i) ? H * (0.6 + 0.18 * rnd(i, 1)) : low(i);
    if (this.row(i)) {
      const n = this.items.length, shift = xi - this.xs[i], ti: [number, number] = [-ni[1], ni[0]];
      const pi = curve(xi), ci: [number, number] = [pi[0], pi[1] - this.hs[i] / 2];
      for (let k = -4; k <= 4; k++) {
        const j = (i + k + n) % n;
        if (j === i || this.row(j)) continue;
        let xj = this.xs[j] + shift; xj -= Math.round((xj - xi) / L) * L;
        const pj = curve(xj), nj = normal(xj), lj = low(j);
        const cj: [number, number] = [pj[0] + nj[0] * lj, pj[1] + nj[1] * lj - this.hs[j] / 2];
        const dx = ci[0] - cj[0], dy = ci[1] - cj[1];
        const ext = (w: number, h: number, v: [number, number]) => w * Math.abs(v[0]) + h * Math.abs(v[1]);
        const need = (ext(this.ws[i], this.hs[i], ni) + ext(this.ws[j], this.hs[j], ni)) / 2 + gap - (dx * ni[0] + dy * ni[1]);
        const sepT = Math.abs(dx * ti[0] + dy * ti[1]) - (ext(this.ws[i], this.hs[i], ti) + ext(this.ws[j], this.hs[j], ti)) / 2;
        const s = 1 - Math.min(1, Math.max(0, (sepT - gap) / (H * 0.8)));   // s'écarte en douceur à l'approche
        d = Math.max(d, need * s * s * (3 - 2 * s));
      }
    }
    return [ni[0] * d, -ni[1] * d];
  }

  /** Taille à l'écran : la perspective grossit les images qui arrivent sur les côtés (plus près de nous) ;
   *  on compense, et on les rend même un peu plus petites vers les bords de l'écran. */
  private sideScale(x: number, y: number, st: number) {
    const P = 1150;                                          // perspective de .stage
    const near = P / Math.max(200, P - y * st);              // grossissement dû à la perspective
    const u = Math.min(1, Math.abs(x) / (this.geo.vw / 2));
    const near0 = P / Math.max(200, P + this.geo.R * 0.74 * st);   // au centre : taille inchangée
    return (1 - 0.28 * u * u) * near0 / near;
  }

  private place(_t: number) {
    const { R, H, step, D } = this.geo, deg = 180 / Math.PI, n = this.items.length;
    if (!n) return;
    const spin = this.pos * step;                        // rotation du disque (radians), liée aux images et à leurs fils ; sens horaire
    this.body.style.setProperty('--spin', `${(spin * deg).toFixed(3)}deg`);
    const tilt = TILT * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
    // tailles fixes par image (rien ne grossit ni ne flotte : stable)
    const X = this.xs, L = this.xsLen;
    // la bande avance d'un mouvement uniforme (aucun « aimant » au passage du centre), au rythme du disque
    const xpos = -this.pos * (L / n);
    const lim = this.geo.vw / 2 + H * 2.4;     // au-delà : hors de l'écran
    for (let i = 0; i < n; i++) {
      const c = this.cards[i], th = this.threads[i], dot = this.dots[i];
      let xi = X[i] - xpos; xi -= Math.round(xi / L) * L;
      if (Math.abs(xi) > lim) {
        if (c.style.display !== 'none') { c.style.display = 'none'; th.style.display = 'none'; dot.style.display = 'none'; }
        continue;
      }
      if (c.style.display !== 'block') {
        c.style.display = 'block'; th.style.display = 'block'; dot.style.display = 'block';
        if (c.dataset.src) { const img = new Image(); img.alt = ''; img.decoding = 'async'; img.src = c.dataset.src; c.querySelector('.pic')!.append(img); delete c.dataset.src; }
      }
      this.hover[i] += (this.hoverTo[i] - this.hover[i]) * 0.18;   // léger grossissement au survol
      const s = this.sideScale(xi, -R * 0.74 + (xi * xi) / (2 * R * 0.74 * CURVE), st) * (1 + 0.07 * this.hover[i]), e = Math.abs(xi) < (L / n) * 0.5 ? 1 : 0;
      // trajectoire douce (arc de parabole), sans à-coup aux bords de l'écran
      const Rb = R * 0.74, y = -Rb + (xi * xi) / (2 * Rb * CURVE);   // plus près du centre du disque ; suit sa courbure jusqu'hors de l'écran
      const [ox, oy] = this.offsetOf(i, xi, ct, Rb, L);   // deux rangées qui ne se touchent jamais, le long de la courbure
      // la perspective écarte les images sur les côtés (plus près de nous) : on resserre d'autant
      const Pp = 1150, comp = (Pp / Math.max(200, Pp + Rb * st)) / (Pp / Math.max(200, Pp - y * st));
      const x = (xi + ox) * comp;
      // plafond : le haut de l'image ne dépasse pas le bas du titre
      const P = 1150, f = P / Math.max(200, P - y * st), py0 = this.geo.vh * 0.3;
      const room = (this.planeTop + y * ct - py0) - (this.ceil - py0) / f;          // hauteur libre sous le titre
      let sc = s;
      if (oy + this.hs[i] * sc > room) sc = Math.max(s * 0.6, (room - oy) / this.hs[i]);   // trop haut : l'image rapetisse au lieu de descendre sur sa voisine
      const lift = Math.max(0, Math.min(oy, room - this.hs[i] * sc));
      const fwd = 0;
      c.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) rotateX(calc(-1 * var(--tilt))) translate3d(0, ${(-lift).toFixed(1)}px, ${fwd.toFixed(1)}px) scale(${sc.toFixed(3)})`;
      c.classList.toggle('top', e > 0.5);
      // le fil : du bas de l'image vers un point fixé SUR le disque (il tourne exactement avec lui)
      const by = y - lift * ct + fwd * st, bz = lift * st + fwd * ct;
      const rq = (0.62 + 0.34 * rnd(i, 4)) * D / 2, aq = xi / R + (rnd(i, 5) - 0.5) * step * 0.8;   // tourne exactement avec le disque
      const qx = rq * Math.sin(aq), qy = -rq * Math.cos(aq);
      const vx = x - qx, vy = by - qy, vz = bz;
      let px = vy, py = -vx; const pl = Math.hypot(px, py) || 1; px /= pl; py /= pl;
      let zx = py * vz, zy = -px * vz, zz = px * vy - py * vx; const zl = Math.hypot(zx, zy, zz) || 1; zx /= zl; zy /= zl; zz /= zl;
      th.style.transform = `matrix3d(${px},${py},0,0, ${vx},${vy},${vz},0, ${zx},${zy},${zz},0, ${qx},${qy},0.5,1)`;
      dot.style.transform = `translate3d(${qx.toFixed(1)}px, ${qy.toFixed(1)}px, 0.6px)`;
    }
  }

  // ─── les faces du disque ─────────────────────────────────────────────────────
  private photos: (HTMLImageElement | null)[] = [null, null];
  private crops: ([number, number, number, number] | null)[] = [null, null];

  private loadFace(k: number, src: string) {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      this.photos[k] = img;
      let cr = findDisc(img);
      if (src === FACE) {
        // la photo est légèrement excentrée : on tourne autour du centre des sillons (mesuré sur l'étiquette
        // et l'anneau qui l'entoure), pas autour du centre de l'image — le disque ne « bat » plus en tournant
        const s = img.naturalWidth / 2048, cx = 1035 * s, cy = 1043 * s;
        cr = [cx - cr[2] / 2, cy - cr[3] / 2, cr[2], cr[3]];
      }
      this.crops[k] = cr; this.drawFace(k);
    };
    img.onerror = () => this.drawFace(k);
    img.src = src;
  }

  private drawFace(k: number) {
    const c = this.faces[k], D = this.geo.D;
    const px = k === 1 ? 64 : Math.min(2048, Math.round(D * Math.min(devicePixelRatio || 1, 1.5)));   // la face arrière n'est jamais visible : inutile de la peindre en grand
    if (c.width !== px) c.width = c.height = px;
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.save(); g.beginPath(); g.arc(px / 2, px / 2, px / 2, 0, Math.PI * 2); g.clip();
    const p = this.photos[k], cr = this.crops[k];
    if (p && cr) { g.imageSmoothingQuality = 'high'; g.drawImage(p, cr[0], cr[1], cr[2], cr[3], 0, 0, px, px); }
    else paintDisc(g, px, k === 1);
    g.restore();
  }
}

/** Repère le disque dans la photo : la plus grande zone qui se détache du fond (mesuré sur les bords). */
function findDisc(img: HTMLImageElement): [number, number, number, number] {
  const s = 256, k = s / Math.max(img.naturalWidth, img.naturalHeight);
  const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!; g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let br = 0, bg = 0, bb = 0, ne = 0;
  const addEdge = (x: number, y: number) => { const i = (y * w + x) * 4; br += d[i]; bg += d[i + 1]; bb += d[i + 2]; ne++; };
  for (let x = 0; x < w; x++) { addEdge(x, 0); addEdge(x, h - 1); }
  for (let y = 0; y < h; y++) { addEdge(0, y); addEdge(w - 1, y); }
  br /= ne; bg /= ne; bb /= ne;
  const rows = new Array(h).fill(0), cols = new Array(w).fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (Math.abs(d[i] - br) + Math.abs(d[i + 1] - bg) + Math.abs(d[i + 2] - bb) > 75) { rows[y]++; cols[x]++; }
  }
  const span = (a: number[], n: number) => { const m = Math.max(...a) * 0.08; let lo = 0, hi = n - 1; while (lo < n && a[lo] <= m) lo++; while (hi > 0 && a[hi] <= m) hi--; return [lo, hi]; };
  const [x0, x1] = span(cols, w), [y0, y1] = span(rows, h);
  const size = Math.max(x1 - x0, y1 - y0) + 1, cx = (x0 + x1 + 1) / 2, cy = (y0 + y1 + 1) / 2;
  if (size < s * 0.3 || size > s * 1.05) { const m = Math.min(img.naturalWidth, img.naturalHeight); return [(img.naturalWidth - m) / 2, (img.naturalHeight - m) / 2, m, m]; }
  return [(cx - size / 2) / k, (cy - size / 2) / k, size / k, size / k];
}

/** En attendant les photos : un disque d'or peint (sillons, étiquette, trou). */
function paintDisc(g: CanvasRenderingContext2D, px: number, back: boolean) {
  const r = px / 2;
  g.translate(r, r);
  const base = g.createRadialGradient(-r * 0.25, -r * 0.3, r * 0.05, 0, 0, r);
  base.addColorStop(0, back ? '#d9c27f' : '#f3dc9c'); base.addColorStop(0.45, '#c9a256'); base.addColorStop(0.85, '#8d6a2c'); base.addColorStop(1, '#5d4419');
  g.fillStyle = base; g.fillRect(-r, -r, px, px);
  let seed = back ? 11 : 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  if (!back) for (let rr = r * 0.36; rr < r * 0.975; rr += Math.max(1, px / 900)) {
    g.strokeStyle = `rgba(${rnd() > 0.5 ? '40,28,8' : '255,240,200'},${(0.04 + rnd() * 0.07).toFixed(3)})`;
    g.lineWidth = Math.max(0.6, px / 1800);
    g.beginPath(); g.arc(0, 0, rr, 0, Math.PI * 2); g.stroke();
  }
  g.fillStyle = '#a07d39'; g.beginPath(); g.arc(0, 0, r * (back ? 0.9 : 0.33), 0, Math.PI * 2); g.fill();
  g.fillStyle = '#050505'; g.beginPath(); g.arc(0, 0, r * 0.022, 0, Math.PI * 2); g.fill();
}
