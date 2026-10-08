/**
 * Le son du disque. Tout passe par une seule platine (Web Audio, sans dépendance) :
 *
 * - Accueil : à chaque chargement de page, un bonjour tiré au hasard, puis le chant des baleines, en boucle.
 * - Interface du disque : les musiques, ordre tiré au hasard, chaque morceau passe une fois avant
 *   qu'un tirage recommence (jamais deux fois le même à la suite), sans fin.
 * - La vitesse de lecture suit la rotation du disque, comme un vrai vinyle : plus il tourne vite,
 *   plus c'est rapide et aigu (`setSpeed`, 1 = lecture normale).
 * - `tune()` : changement de morceau, comme sur une platine : le disque freine sous la main, le diamant
 *   frotte le sillon, le bras se repose, et un autre morceau démarre en reprenant sa vitesse.
 * - Traitement « vieux, lointain » : bande étroite (étouffé), légère saturation, pleurage (le disque
 *   ondule), craquements et souffle du vinyle, longue réverbération froide (l'espace).
 *
 * Les fichiers : public/audio/index.json → { "salutations": ["salutations/x.mp3", …], "baleines": "baleines.mp3", "musiques": […] }
 * (chemins relatifs à /audio/). Sans fichiers, des sons de test synthétiques remplacent les vrais.
 *
 * Les navigateurs n'autorisent le son qu'après un geste (clic, touche, toucher) : la platine démarre
 * au premier geste, sur place.
 */
type Bin = 'salutations' | 'musiques';

const LIMIT = 3;                // vitesse de lecture max (×3)

class Platine {
  private ctx: AudioContext | null = null;
  private out!: GainNode;                     // entrée du traitement
  private bins: Record<Bin, string[]> = { salutations: [], musiques: [] };
  private whale = '';                          // le chant des baleines (après le bonjour)
  private greeted = false;                     // un seul bonjour par chargement de page, puis les baleines
  private bags: Record<Bin, number[]> = { salutations: [], musiques: [] };
  private lastPicked: Record<Bin, number> = { salutations: -1, musiques: -1 };
  private cache = new Map<string, Promise<AudioBuffer | null>>();
  private test: Record<Bin, AudioBuffer[]> = { salutations: [], musiques: [] };
  private bin: Bin = 'salutations';
  private cur: { src: AudioBufferSourceNode; gain: GainNode } | null = null;
  private playing = new Set<{ src: AudioBufferSourceNode; gain: GainNode; ending?: boolean }>();   // tout ce qui sonne : jamais deux morceaux à la fois
  private crackle: AudioBufferSourceNode | null = null;
  private wow: OscillatorNode | null = null;
  private wowDepth!: GainNode;
  private rate = 1;
  private wanted = false;                     // la lecture a été demandée (avant le premier geste)
  private token = 0;                          // annule les enchaînements d'un bac quitté
  private tuning = false;
  private preMusic: number | null = null;
  private surface: AudioBufferSourceNode[] = [];   // bruits de surface qui suivent la vitesse du disque
  private near: GainNode | null = null;
  private nearV = 1;
  /** Proximité du disque (0 : loin, 1 : tout près = volume habituel). */
  setNear(v: number) {
    const nv = 0.18 + 0.82 * Math.max(0, Math.min(1, v));
    if (Math.abs(nv - this.nearV) < 1e-4) return;   // inchangé : rien à programmer (appelé à chaque image)
    this.nearV = nv;
    if (this.near && this.ctx) this.near.gain.setTargetAtTime(this.nearV, this.ctx.currentTime, 0.12);
  }
  private speedSrc: unknown = null;
  private userBlobs = new Map<string, Blob>();   // sons ajoutés par les visiteurs ('user:<id>')
  private forced: string | null = null;           // morceau à jouer juste après (un son qu'on vient d'ajouter)

  /** Un son ajouté par un visiteur rejoint les musiques du disque ; `now` : on le joue tout de suite. */
  addUser(id: string, blob: Blob, now = false) {
    const key = 'user:' + id;
    if (!this.userBlobs.has(key)) { this.userBlobs.set(key, blob); this.bins.musiques.push(key); this.bags.musiques = []; }
    if (now) { this.forced = key; if (this.bin === 'musiques' && this.ctx?.state === 'running') this.tune(); }
  }
  /** Vérifie qu'un fichier audio se décode (avant de l'enregistrer). */
  async check(blob: Blob): Promise<boolean> {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const own = !this.ctx, ctx = this.ctx ?? new AC();
      try { const buf = await ctx.decodeAudioData(await blob.arrayBuffer()); return buf.duration > 0.2; }
      finally { if (own) void ctx.close(); }   // le contexte d'essai est toujours refermé, même si le fichier est illisible
    } catch { return false; }
  }

  constructor() {
    fetch('/audio/index.json').then((r) => (r.ok ? r.json() : null)).catch(() => null).then((j) => {
      if (j && typeof j === 'object') {
        for (const b of ['salutations', 'musiques'] as Bin[]) if (Array.isArray(j[b])) this.bins[b] = j[b].map(String);
        this.bins.musiques.push(...this.userBlobs.keys());               // les sons des visiteurs déjà ajoutés
        this.bags.musiques = [];
        if (typeof j.baleines === 'string') this.whale = j.baleines;
      }
    });
    const unlock = () => { this.start(); };
    for (const ev of ['pointerdown', 'keydown', 'touchstart']) window.addEventListener(ev, unlock, { passive: true });
  }

  /** Joue un bac en continu (sans geste : en attente du premier geste). */
  play(bin: Bin) {
    this.wanted = true;
    if (this.bin === bin && this.cur) return;
    this.bin = bin;
    if (this.ctx && this.ctx.state === 'running') { this.token++; this.fadeOutCurrent(1.2); this.next(); }
  }

  /** Vitesse de lecture (1 = normale), lissée comme l'inertie d'un plateau. */
  setSpeed(r: number) {
    const nr = Math.max(0.25, Math.min(LIMIT, r));
    if (Math.abs(nr - this.rate) < 1e-4 && this.speedSrc === this.cur) return;   // inchangé pour le même morceau : rien à programmer
    this.rate = nr; this.speedSrc = this.cur;
    if (!this.ctx || !this.cur) return;
    const t = this.ctx.currentTime;
    this.cur.src.playbackRate.setTargetAtTime(this.rate, t, 0.08);
    this.crackle?.playbackRate.setTargetAtTime(Math.max(0.4, this.rate), t, 0.1);
    for (const n of this.surface) n.playbackRate.setTargetAtTime(Math.max(0.4, this.rate), t, 0.1);
    this.wowDepth.gain.setTargetAtTime(1 + 1.4 * Math.max(0, this.rate - 1), t, 0.2);   // ça ondule plus quand ça s'emballe
  }

  /** Changement de station : souffle et sifflement entre deux musiques, puis une autre. */
  tune() {
    if (!this.ctx || this.ctx.state !== 'running' || this.tuning) return;
    this.tuning = true; this.token++;
    const ctx = this.ctx, t = ctx.currentTime;
    // le morceau en cours ralentit doucement et s'efface (le plateau qu'on freine sans brusquer)
    const c = this.cur; this.cur = null;
    if (c) {
      (c as { ending?: boolean }).ending = true;
      c.src.playbackRate.cancelScheduledValues(t); c.src.playbackRate.setValueAtTime(c.src.playbackRate.value, t);
      c.src.playbackRate.exponentialRampToValueAtTime(Math.max(0.35, this.rate * 0.45), t + 0.8);
      c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + 0.8);
      try { c.src.stop(t + 0.85); } catch { /* déjà arrêté */ }
    }
    // un souffle chaud et grave qui enfle puis retombe, comme un passage entre deux faces
    const n = ctx.createBufferSource(); n.buffer = this.noise(1.4);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.7;
    lp.frequency.setValueAtTime(300, t); lp.frequency.linearRampToValueAtTime(900, t + 0.5); lp.frequency.linearRampToValueAtTime(250, t + 1.2);
    const ng = ctx.createGain(); ng.gain.setValueAtTime(0, t); ng.gain.linearRampToValueAtTime(0.3, t + 0.45); ng.gain.linearRampToValueAtTime(0, t + 1.25);   // plus présent
    n.connect(lp).connect(ng).connect(this.out); n.start(t); n.stop(t + 1.4);
    // le morceau suivant arrive en douceur, en reprenant sa vitesse
    setTimeout(() => { this.tuning = false; this.next(true); }, 550);
  }

  /** Le disque qu'on pousse à rebours : quelques allers-retours de scratch, sans changer de morceau. */
  scratch() {
    if (!this.ctx || this.ctx.state !== 'running' || this.tuning) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const sc = ctx.createBufferSource(); sc.buffer = this.noise(0.5);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 1.4;
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0, t);
    for (let k = 0; k < 4; k++) {
      const s = t + 0.02 + k * 0.085, f = 900 + Math.random() * 900;
      bp.frequency.setValueAtTime(f, s); bp.frequency.exponentialRampToValueAtTime(f * (k % 2 ? 0.45 : 2.1), s + 0.07);
      sg.gain.setValueAtTime(0, s); sg.gain.linearRampToValueAtTime(0.32 - k * 0.05, s + 0.012); sg.gain.exponentialRampToValueAtTime(0.004, s + 0.075);
    }
    sc.connect(bp).connect(sg).connect(this.out); sc.start(t); sc.stop(t + 0.5);
  }

  /**
   * Gravure : une image vient d'être ajoutée au disque. Un geste discret de graveur — le burin se pose,
   * creuse un court sillon (un frottement aigu et serré qui tourne), puis se relève. Il passe par le même
   * traitement que le reste, donc il se fond dans le son du disque.
   */
  engrave() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const ctx = this.ctx, t = ctx.currentTime, d = 1.3;
    // le burin se pose : un petit contact sourd
    const tap = ctx.createOscillator(); tap.type = 'sine'; tap.frequency.setValueAtTime(180, t); tap.frequency.exponentialRampToValueAtTime(90, t + 0.06);
    const tg = ctx.createGain(); tg.gain.setValueAtTime(0, t); tg.gain.linearRampToValueAtTime(0.12, t + 0.004); tg.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    tap.connect(tg).connect(this.out); tap.start(t); tap.stop(t + 0.1);
    // le sillon se creuse : frottement serré, modulé au rythme de la rotation, qui monte puis s'éteint
    const n = ctx.createBufferSource(); n.buffer = this.noise(d + 0.1);
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 6;
    bp.frequency.setValueAtTime(1300, t + 0.05); bp.frequency.linearRampToValueAtTime(1750, t + d);
    const g = ctx.createGain(); g.gain.setValueAtTime(0, t + 0.05); g.gain.linearRampToValueAtTime(0.11, t + 0.3); g.gain.setValueAtTime(0.11, t + d - 0.35); g.gain.linearRampToValueAtTime(0, t + d);
    const mod = ctx.createOscillator(); mod.frequency.value = 22;                  // la matière qui vibre sous la pointe
    const mg = ctx.createGain(); mg.gain.value = 0.04; mod.connect(mg).connect(g.gain);
    n.connect(bp).connect(g).connect(this.out); n.start(t + 0.05); n.stop(t + d + 0.1); mod.start(t); mod.stop(t + d + 0.1);
    // le burin se relève : un léger « tic »
    const up = ctx.createBufferSource(); up.buffer = this.noise(0.02);
    const uf = ctx.createBiquadFilter(); uf.type = 'highpass'; uf.frequency.value = 1500;
    const ug = ctx.createGain(); ug.gain.setValueAtTime(0.06, t + d); ug.gain.exponentialRampToValueAtTime(0.001, t + d + 0.018);
    up.connect(uf).connect(ug).connect(this.out); up.start(t + d); up.stop(t + d + 0.02);
  }

  // ─── interne ──────────────────────────────────────────────────────────────
  private start() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.build();
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
    if (this.wanted && !this.cur) this.next();
  }

  /** Le traitement : étouffé, un peu saturé, qui ondule, lointain. */
  /**
   * Le traitement. Références : les 78 tours en gomme-laque (bande très étroite, souffle, craquements),
   * les ondes courtes (le signal qui s'évanouit et revient), les boucles de bande qui se désagrègent
   * de William Basinski (« The Disintegration Loops ») et les 78 tours rongés de The Caretaker
   * (« Everywhere at the End of Time ») : un son usé, voilé, qui flotte loin dans une grande réverbération.
   */
  private build() {
    const ctx = this.ctx!;
    this.out = ctx.createGain(); this.out.gain.value = 1;
    // un signal reçu de loin : bande très étroite, raide (cascade de filtres), comme une radio ou un vieux haut-parleur
    const hp1 = ctx.createBiquadFilter(); hp1.type = 'highpass'; hp1.frequency.value = 420; hp1.Q.value = 0.7;
    const hp2 = ctx.createBiquadFilter(); hp2.type = 'highpass'; hp2.frequency.value = 360; hp2.Q.value = 0.5;
    const lp1 = ctx.createBiquadFilter(); lp1.type = 'lowpass'; lp1.frequency.value = 1700; lp1.Q.value = 0.9;
    const lp2 = ctx.createBiquadFilter(); lp2.type = 'lowpass'; lp2.frequency.value = 2100; lp2.Q.value = 0.6;
    const lp3 = ctx.createBiquadFilter(); lp3.type = 'lowpass'; lp3.frequency.value = 2600; lp3.Q.value = 0.5;
    const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.gain.value = 5; mid.Q.value = 1.1;
    const sat = ctx.createWaveShaper(); sat.curve = warm(1.7); sat.oversample = '4x';   // saturation « chaude » : arrondit doucement les crêtes, sans grésiller
    // lo-fi : moins d'échantillons et moins de bits (le son « numérique usé »)
    const lofi = this.crusher();
    // le signal qui s'évanouit et revient, et de brèves coupures
    const fade = ctx.createGain(); fade.gain.value = 0.8;
    const fadeLfo = ctx.createOscillator(); fadeLfo.frequency.value = 0.09;
    const fadeAmt = ctx.createGain(); fadeAmt.gain.value = 0.16;
    fadeLfo.connect(fadeAmt).connect(fade.gain); fadeLfo.start();
    const drop = ctx.createGain(); drop.gain.value = 1;
    const dropout = () => {
      const t = ctx.currentTime, d = 0.05 + Math.random() * 0.18, depth = 0.2 + Math.random() * 0.4;
      drop.gain.setTargetAtTime(depth, t, 0.012); drop.gain.setTargetAtTime(1, t + d, 0.04);
      setTimeout(dropout, 3000 + Math.random() * 8000);
    };
    setTimeout(dropout, 4000);
    // une pièce, pas une cathédrale : réverbération courte et discrète
    const dry = ctx.createGain(); dry.gain.value = 0.9;
    const verb = ctx.createConvolver(); verb.buffer = this.spaceIR(1.6);
    const wet = ctx.createGain(); wet.gain.value = 0.14;
    const master = ctx.createGain(); master.gain.value = 0.42;
    this.out.connect(hp1).connect(hp2).connect(mid).connect(sat).connect(lofi.input);
    lofi.output.connect(lp1).connect(lp2).connect(lp3).connect(fade).connect(drop);
    drop.connect(dry).connect(master);
    drop.connect(verb).connect(wet).connect(master);
    // proximité : le disque lointain (petit) s'entend plus faiblement, il arrive sur nous et le son monte
    this.near = ctx.createGain(); this.near.gain.value = this.nearV;
    master.connect(this.near).connect(ctx.destination);
    // pleurage + scintillement de la hauteur (bande et platine usées)
    this.wowDepth = ctx.createGain(); this.wowDepth.gain.value = 1;
    this.wow = ctx.createOscillator(); this.wow.frequency.value = 0.38;
    const wowAmt = ctx.createGain(); wowAmt.gain.value = 20;
    this.wow.connect(wowAmt).connect(this.wowDepth); this.wow.start();
    const flutter = ctx.createOscillator(); flutter.frequency.value = 5.8;
    const flutAmt = ctx.createGain(); flutAmt.gain.value = 6;
    flutter.connect(flutAmt).connect(this.wowDepth); flutter.start();
    // les bruits du lo-fi : craquements de vinyle, souffle de cassette, ronflement, parasites radio
    this.crackle = ctx.createBufferSource(); this.crackle.buffer = this.crackleBuffer(8); this.crackle.loop = true;
    const cg = ctx.createGain(); cg.gain.value = 0.16;                       // grésillement plus discret
    const chp = ctx.createBiquadFilter(); chp.type = 'highpass'; chp.frequency.value = 500;
    const clp = ctx.createBiquadFilter(); clp.type = 'lowpass'; clp.frequency.value = 2600;   // adouci : plus de piqûres aiguës
    // tous les bruits du disque passent par la même chaîne que la musique (même bande, même grain, même pièce) : ils font corps avec elle
    this.crackle.connect(chp).connect(clp).connect(cg).connect(this.out);
    this.crackle.start();
    // souffle feutré : bruit rose (comme une pluie fine), aigus coupés pour qu'il ne pique pas
    const hiss = ctx.createBufferSource(); hiss.buffer = this.pink(6); hiss.loop = true;
    const hissF = ctx.createBiquadFilter(); hissF.type = 'lowpass'; hissF.frequency.value = 2600; hissF.Q.value = 0.5;
    const hissG = ctx.createGain(); hissG.gain.value = 0.05;
    // bruit de sillon : le frottement sourd et continu du diamant dans le disque qui tourne
    const groove = ctx.createBufferSource(); groove.buffer = this.brown(7); groove.loop = true;
    const gf = ctx.createBiquadFilter(); gf.type = 'bandpass'; gf.frequency.value = 650; gf.Q.value = 0.7;
    const gg = ctx.createGain(); gg.gain.value = 0.11;
    groove.connect(gf).connect(gg).connect(this.out); groove.start();
    this.surface.push(groove);
    // craquements « feu de camp » : petits bruits secs, espacés, de tailles variées, au hasard
    const fire = ctx.createBufferSource(); fire.buffer = this.fireBuffer(13); fire.loop = true;
    const fhp = ctx.createBiquadFilter(); fhp.type = 'highpass'; fhp.frequency.value = 350;
    const flp = ctx.createBiquadFilter(); flp.type = 'lowpass'; flp.frequency.value = 4200;
    const fg = ctx.createGain(); fg.gain.value = 0.32;
    fire.connect(fhp).connect(flp).connect(fg).connect(this.out); fire.start();
    this.surface.push(fire);
    hiss.connect(hissF).connect(hissG).connect(this.out); hiss.start();
    const stat = ctx.createBufferSource(); stat.buffer = this.noise(5); stat.loop = true;   // parasites qui respirent
    const statF = ctx.createBiquadFilter(); statF.type = 'bandpass'; statF.frequency.value = 1300; statF.Q.value = 3;
    const statG = ctx.createGain(); statG.gain.value = 0.007;
    const statLfo = ctx.createOscillator(); statLfo.frequency.value = 0.17; const statAmt = ctx.createGain(); statAmt.gain.value = 0.006;
    statLfo.connect(statAmt).connect(statG.gain); statLfo.start();
    stat.connect(statF).connect(statG).connect(this.out); stat.start();
    const hum = ctx.createOscillator(); hum.frequency.value = 50; const hg = ctx.createGain(); hg.gain.value = 0.01;
    hum.connect(hg).connect(master); hum.start();
    this.lofiEvents(master, this.out);
    this.vinylEvents(master, drop);
    this.test.salutations = Array.from({ length: 7 }, (_, i) => this.fakeVoice(i));
    this.test.musiques = Array.from({ length: 4 }, (_, i) => this.fakeMusic(i));
  }

  /**
   * Petits « parasites » lo-fi, rares et doux à l'oreille : un « pop » chaud de vinyle (grave, arrondi),
   * le ronronnement sourd du plateau, et de temps en temps la bande qui ondule un instant (la hauteur
   * fléchit puis revient).
   */
  private lofiEvents(master: AudioNode, into: AudioNode) {
    const ctx = this.ctx!;
    // ronronnement du plateau : un souffle très grave, à peine là
    const rum = ctx.createBufferSource(); rum.buffer = this.noise(4); rum.loop = true;
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 90;
    const rg = ctx.createGain(); rg.gain.value = 0.09;
    rum.connect(rlp).connect(rg).connect(master); rum.start();
    // pops chauds : un petit coup sourd, filtré, de loin en loin
    const pop = () => {
      const t = ctx.currentTime, f = 140 + Math.random() * 160;
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(f, t); o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.08);
      const g = ctx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.05 + Math.random() * 0.05, t + 0.004); g.gain.exponentialRampToValueAtTime(0.0005, t + 0.12);
      o.connect(g).connect(into); o.start(t); o.stop(t + 0.14);
      setTimeout(pop, 3000 + Math.random() * 6000);
    };
    setTimeout(pop, 2000);
    // la bande ondule un instant : la hauteur fléchit doucement puis revient
    const warble = () => {
      const t = ctx.currentTime, dip = 18 + Math.random() * 22, d = 0.5 + Math.random() * 0.6;
      const o = ctx.createConstantSource(); o.offset.setValueAtTime(0, t);
      o.offset.linearRampToValueAtTime(-dip, t + d * 0.4); o.offset.linearRampToValueAtTime(0, t + d);
      o.connect(this.wowDepth); o.start(t); o.stop(t + d + 0.05);
      setTimeout(warble, 9000 + Math.random() * 14000);
    };
    setTimeout(warble, 7000);
  }

  /**
   * Ce qu'on entend sur un vrai vinyle, en plus du souffle et des craquements :
   * - une rayure qui « tique » à chaque tour du plateau (le rythme suit la vitesse du disque) ;
   * - l'écho de sillon : le sillon voisin qui s'entend faiblement, un tour plus tard ;
   * - le disque légèrement voilé ou décentré : le volume et la hauteur respirent à chaque tour ;
   * - de petites grappes de poussière qui grésillent ensemble, de temps en temps.
   */
  private vinylEvents(master: AudioNode, sig: AudioNode) {
    const ctx = this.ctx!;
    const turn = () => 1.8 / Math.max(0.3, this.rate);           // durée d'un tour (16⅔ tr/min ≈ 3,6 s ; ici un tour « audible » ≈ 1,8 s)
    // la rayure : un petit « tic » sourd à chaque tour
    const tick = () => {
      const t = ctx.currentTime;
      const n = ctx.createBufferSource(); n.buffer = this.noise(0.03);
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800 + Math.random() * 600; bp.Q.value = 1.2;
      const g = ctx.createGain(); g.gain.setValueAtTime(0.09, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.025);
      n.connect(bp).connect(g).connect(this.out); n.start(t); n.stop(t + 0.03);
      setTimeout(tick, turn() * 1000);
    };
    setTimeout(tick, 1500);
    // l'écho de sillon : la même musique, très faible et sourde, un tour plus tard
    const echo = ctx.createDelay(3); echo.delayTime.value = 1.8;
    const elp = ctx.createBiquadFilter(); elp.type = 'lowpass'; elp.frequency.value = 1200;
    const eg = ctx.createGain(); eg.gain.value = 0.035;
    sig.connect(echo).connect(elp).connect(eg).connect(master);
    // le disque voilé : le volume ondule à chaque tour
    const warp = ctx.createOscillator(); warp.frequency.value = 1 / 1.8;
    const wg = ctx.createGain(); wg.gain.value = 0.06;
    warp.connect(wg).connect((master as GainNode).gain); warp.start();
    const warpPitch = ctx.createGain(); warpPitch.gain.value = 9;      // et la hauteur, un peu (cents)
    warp.connect(warpPitch).connect(this.wowDepth);
    // grappes de poussière
    const dust = () => {
      const t0 = ctx.currentTime, k = 2 + Math.floor(Math.random() * 4);
      for (let i = 0; i < k; i++) {
        const t = t0 + i * (0.02 + Math.random() * 0.05);
        const n = ctx.createBufferSource(); n.buffer = this.noise(0.012);
        const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1500;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
        const g = ctx.createGain(); g.gain.setValueAtTime(0.05 + Math.random() * 0.05, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.01);
        n.connect(hp).connect(lp).connect(g).connect(this.out); n.start(t); n.stop(t + 0.015);
      }
      setTimeout(dust, 8000 + Math.random() * 14000);
    };
    setTimeout(dust, 3000);
    // le rythme du voile suit la vitesse du plateau
    setInterval(() => { warp.frequency.setTargetAtTime(1 / turn(), ctx.currentTime, 0.3); }, 400);
  }

  /** Réduction d'échantillonnage et de bits (AudioWorklet) ; à défaut, une simple quantification. */
  private crusher(): { input: AudioNode; output: AudioNode } {
    const ctx = this.ctx!;
    const pass = ctx.createGain();
    const fallback = () => { const w = ctx.createWaveShaper(); w.curve = stepped(48); pass.connect(w); return w; };
    const out = ctx.createGain();
    const fb = fallback(); fb.connect(out);
    if (ctx.audioWorklet) {
      const code = `class C extends AudioWorkletProcessor{constructor(){super();this.h=0;this.c=0}process(i,o){const a=i[0],b=o[0];if(!a||!a.length)return true;for(let ch=0;ch<b.length;ch++){const x=a[Math.min(ch,a.length-1)],y=b[ch];for(let k=0;k<y.length;k++){if(this.c<=0){this.h=Math.round(x[k]*64)/64;this.c=3}this.c--;y[k]=this.h}}return true}}registerProcessor('lofi',C);`;
      const url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
      ctx.audioWorklet.addModule(url).then(() => {
        const node = new AudioWorkletNode(ctx, 'lofi');                 // ≈ 16 kHz, ~7 bits
        pass.disconnect(); pass.connect(node).connect(out);
      }).catch(() => { /* on garde la quantification simple */ });
    }
    return { input: pass, output: out };
  }

  /** Tirage sans remise : tout passe une fois avant de recommencer, jamais deux fois de suite le même. */
  private pick(bin: Bin, n: number) {
    if (!this.bags[bin].length || this.bags[bin].some((i) => i >= n)) {   // tiroir vide, ou tiré pour une autre liste : on refait le tirage
      const a = Array.from({ length: n }, (_, i) => i);
      for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
      if (a.length > 1 && a[a.length - 1] === this.lastPicked[bin]) [a[0], a[a.length - 1]] = [a[a.length - 1], a[0]];
      this.bags[bin] = a;
    }
    const i = this.bags[bin].pop()!; this.lastPicked[bin] = i; return i;
  }

  private async next(midway = false) {
    const ctx = this.ctx; if (!ctx) return;
    const bin = this.bin, tok = this.token;
    const files = this.bins[bin];
    let buf: AudioBuffer | null = null, loop = false, path: string | null = null;
    if (bin === 'salutations' && this.greeted && this.whale) { buf = await this.load(this.whale); loop = true; }   // après le bonjour : les baleines, sans fin
    else if (bin === 'musiques' && this.forced) { path = this.forced; buf = await this.load(path); this.forced = null; }   // le son qu'on vient d'ajouter
    else if (bin === 'musiques' && this.preMusic !== null && files.length) { path = files[this.preMusic]; buf = await this.load(path); this.preMusic = null; }   // déjà chargé pendant l'accueil
    else if (files.length) { path = files[this.pick(bin, files.length)]; buf = await this.load(path); }
    if (bin === 'salutations' && this.preMusic === null && this.bins.musiques.length) {   // on prépare la première musique pendant que les baleines chantent
      this.preMusic = this.pick('musiques', this.bins.musiques.length); void this.load(this.bins.musiques[this.preMusic]);
    }
    if (bin === 'salutations') this.greeted = true;
    if (!buf) { const t = this.test[bin]; buf = t[this.pick(bin, t.length)]; }
    if (tok !== this.token || bin !== this.bin || this.cur) return;   // un autre appel a déjà lancé un morceau : pas de doublon
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = loop;
    const gain = ctx.createGain(); const t = ctx.currentTime;
    if (midway) { src.playbackRate.setValueAtTime(this.rate * 0.7, t); src.playbackRate.setTargetAtTime(this.rate, t, 0.35); }   // le plateau reprend sa vitesse
    else src.playbackRate.value = this.rate;
    this.wowDepth.connect(src.detune);
    gain.gain.setValueAtTime(0, t); gain.gain.linearRampToValueAtTime(1, t + (midway ? 0.6 : bin === 'musiques' ? 2.5 : 0.05));   // la musique arrive toujours en fondu
    src.connect(gain).connect(this.out);
    const offset = midway && bin === 'musiques' ? Math.random() * buf.duration * 0.6 : 0;   // radio : on tombe en cours de morceau
    src.start(t, offset);
    const me = { src, gain }; this.cur = me;
    for (const o of this.playing) {                    // un morceau resté orphelin s'efface (il ne reste jamais sous le nouveau)
      if (o === me || o.ending) continue;
      try { o.gain.gain.cancelScheduledValues(t); o.gain.gain.setValueAtTime(o.gain.gain.value, t); o.gain.gain.linearRampToValueAtTime(0, t + 0.4); o.src.stop(t + 0.45); } catch { /* déjà arrêté */ }
    }
    this.playing.add(me);
    src.onended = () => {
      try { this.wowDepth.disconnect(src.detune); } catch { /* déjà fait */ }
      this.playing.delete(me);
      if (bin === 'musiques' && path) this.cache.delete(path);   // un morceau fini quitte la mémoire (sinon toute la playlist décodée s'y accumule)
      if (this.cur === me) { this.cur = null; if (tok === this.token) setTimeout(() => { if (tok === this.token && !this.cur) this.next(); }, bin === 'salutations' ? 250 + Math.random() * 500 : 600); }
    };
  }

  private fadeOutCurrent(sec: number) {
    const c = this.cur, ctx = this.ctx; if (!c || !ctx) return;
    this.cur = null;
    (c as { ending?: boolean }).ending = true;
    const t = ctx.currentTime;
    c.gain.gain.cancelScheduledValues(t); c.gain.gain.setValueAtTime(c.gain.gain.value, t); c.gain.gain.linearRampToValueAtTime(0, t + sec);
    c.src.playbackRate.setTargetAtTime(Math.max(0.3, this.rate * 0.6), t, sec);   // le disque qui s'éloigne ralentit
    try { c.src.stop(t + sec + 0.05); } catch { /* déjà arrêté */ }
  }

  private load(path: string) {
    let p = this.cache.get(path);
    if (!p && path.startsWith('user:')) {
      const b = this.userBlobs.get(path);
      p = b ? b.arrayBuffer().then((a) => this.ctx!.decodeAudioData(a)).catch(() => { this.cache.delete(path); return null; }) : Promise.resolve(null);
      this.cache.set(path, p);
    }
    if (!p) {
      p = fetch('/audio/' + encodeURI(path)).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())).then((a) => this.ctx!.decodeAudioData(a)).catch(() => { this.cache.delete(path); return null; });   // un échec n'est pas définitif : on retentera
      this.cache.set(path, p);
    }
    return p;
  }

  // ─── matières sonores calculées ──────────────────────────────────────────
  private noise(sec: number) {
    const ctx = this.ctx!, b = ctx.createBuffer(1, Math.round(sec * ctx.sampleRate), ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  /** Réverbération « espace » : un long souffle qui décroît, un peu plus sombre à la fin. */
  private spaceIR(sec: number) {
    const ctx = this.ctx!, n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c); let lp = 0;
      for (let i = 0; i < n; i++) {
        const t = i / n, k = 0.5 + 0.45 * t;                   // de plus en plus sombre
        lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
        d[i] = lp * Math.pow(1 - t, 2.4) * 2.2;
      }
    }
    return b;
  }
  /** Bruit rose (filtre de Paul Kellet) : plus doux que le bruit blanc. */
  private pink(sec: number) {
    const ctx = this.ctx!, n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    }
    return b;
  }
  /** Bruit brun : grave et sourd (frottement). */
  private brown(sec: number) {
    const ctx = this.ctx!, n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    return b;
  }
  /** Craquements façon feu de camp : secs, courts, espacés, tailles très variées (quelques gros, beaucoup de petits). */
  private fireBuffer(sec: number) {
    const ctx = this.ctx!, sr = ctx.sampleRate, n = Math.round(sec * sr), b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    let t = 0;
    while (true) {
      t += -Math.log(1 - Math.random()) / 3.5;                     // ~3,5 par seconde, au hasard
      const at = Math.floor(t * sr); if (at >= n - 600) break;
      const size = Math.pow(Math.random(), 3.2);                    // la plupart minuscules, quelques-uns francs
      const a = 0.06 + 0.9 * size, len = Math.floor(sr * (0.0015 + 0.006 * size)), tau = len / 3;
      for (let j = 0; j < len; j++) d[at + j] += a * (Math.random() * 2 - 1) * Math.exp(-j / tau);
      if (size > 0.5 && Math.random() < 0.5) {                      // un gros craquement a souvent un petit écho juste après
        const at2 = at + Math.floor(sr * (0.008 + Math.random() * 0.02));
        for (let j = 0; j < len && at2 + j < n; j++) d[at2 + j] += a * 0.4 * (Math.random() * 2 - 1) * Math.exp(-j / tau);
      }
    }
    return b;
  }
  /** Craquements épars + souffle de surface. */
  private crackleBuffer(sec: number) {
    const ctx = this.ctx!, n = Math.round(sec * ctx.sampleRate), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * 0.035;
    const pops = Math.round(sec * 6);
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(Math.random() * (n - 200)), a = (Math.random() < 0.12 ? 0.5 : 0.2) * (Math.random() < 0.5 ? -1 : 1);
      for (let j = 0; j < 60; j++) d[at + j] += a * Math.exp(-j / 10) * Math.cos(j * 0.6);   // craquement arrondi
    }
    return b;
  }
  /** Son de test : une courte « voix » (voyelles chantées, intonation de salutation). */
  private fakeVoice(seed: number) {
    const ctx = this.ctx!, sr = ctx.sampleRate, sec = 1.4 + (seed % 3) * 0.4, n = Math.round(sec * sr);
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const f0 = 110 + (seed * 37) % 120, vowels = [[730, 1090], [270, 2290], [570, 840], [440, 1020], [300, 870]];
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / n, f = f0 * (1 + 0.25 * Math.sin(Math.PI * t) - 0.15 * t);
      ph += f / sr;
      const v = vowels[(seed + Math.floor(t * 3)) % vowels.length];
      const saw = (ph % 1) * 2 - 1;
      d[i] = (Math.sin(2 * Math.PI * v[0] / f * (ph % 1)) * 0.6 + Math.sin(2 * Math.PI * v[1] / f * (ph % 1)) * 0.3) * 0.5 * Math.abs(saw)
        * Math.min(1, t * 12) * Math.min(1, (1 - t) * 6) * (0.6 + 0.4 * Math.sin(t * 19 + seed));
    }
    return b;
  }
  /** Son de test : une petite musique (arpège doux qui tourne). */
  private fakeMusic(seed: number) {
    const ctx = this.ctx!, sr = ctx.sampleRate, sec = 24, n = Math.round(sec * sr);
    const b = ctx.createBuffer(1, n, sr), d = b.getChannelData(0);
    const roots = [220, 196, 246.9, 174.6], root = roots[seed % 4], scale = [0, 3, 7, 10, 12, 15, 19];
    const step = 0.22 + 0.06 * seed;
    for (let i = 0; i < n; i++) {
      const t = i / sr, k = Math.floor(t / step), u = (t % step) / step;
      const note = root * Math.pow(2, scale[(k * (seed + 2)) % scale.length] / 12);
      const env = Math.exp(-u * 4);
      d[i] = (Math.sin(2 * Math.PI * note * t) * 0.5 + Math.sin(2 * Math.PI * note * 2 * t) * 0.15) * env * 0.5
        + Math.sin(2 * Math.PI * root / 2 * t) * 0.12;
    }
    return b;
  }
}

function stepped(levels: number) {
  const c = new Float32Array(2048);
  for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = Math.round(x * levels) / levels; }
  return c;
}
function warm(k: number) {           // saturation douce et asymétrique (comme un vieil étage à lampes)
  const c = new Float32Array(2048);
  for (let i = 0; i < c.length; i++) { const x = (i / (c.length - 1)) * 2 - 1; c[i] = (Math.tanh(k * x) + 0.08 * x * x) / Math.tanh(k); }
  return c;
}

export const platine = new Platine();
