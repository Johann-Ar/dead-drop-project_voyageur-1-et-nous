/**
 * L'accueil : le recto du disque, seul, au centre.
 * Il tourne toujours au moins à sa vitesse de lecture. En approchant, il accélère, d'autant plus
 * qu'on est près. Le survoler le fait accélérer jusqu'au maximum ; passé un seuil, l'animation est
 * lancée sans retour : il grossit, freine en douceur, se retourne et disparaît pile à plat — le grand
 * disque de l'interface prend le relais au même instant.
 * La vitesse suit le curseur comme au bout d'un ressort : elle dépasse un peu, revient, rebondit —
 * c'est ce qui rend le geste vivant.
 * Au doigt : on pose le doigt sur le disque et on le garde. Entrée / Espace maintenus : idem.
 *
 * `spinNear` donne la même réaction au curseur au petit disque du logo (immobile au repos, sans entrée).
 */
import { platine } from './audio.ts';

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const DEBUG = new URLSearchParams(location.search).has('debug3d');
/** Vitesse de rotation propre du petit disque au moment où il disparaît (°/s) : le grand disque la reprend. */
export let lastSpin = 110;

let mouse: [number, number] | null = null;
const track = (e: MouseEvent) => { mouse = [e.clientX, e.clientY]; };
for (const t of ['pointermove', 'pointerover', 'mousemove', 'pointerdown'] as const) window.addEventListener(t, track as EventListener, { passive: true, capture: true });   // suivi robuste (rien ne peut l'intercepter)
window.addEventListener('mouseout', (e) => { if (!e.relatedTarget) mouse = null; });   // seulement quand la souris quitte vraiment la fenêtre

/** Proximité 0–1 du pointeur à un disque (centre cx, cy, rayon r) ; 1 dès qu'on est dessus. */
function nearness(cx: number, cy: number, r: number, reach: number) {
  if (!mouse) return 0;
  const d = Math.hypot(mouse[0] - cx, mouse[1] - cy);
  return d <= r ? 1 : Math.max(0, 1 - (d - r) / reach);
}

const BASE = 100;                                     // rotation minimale : 16⅔ tours/min (vitesse du Golden Record) = lecture ×1
const MAX = 1100;                                     // degrés/s au maximum
const CHARGE_UP = 0.95;                               // vitesse de montée de l'élan au survol
const REACH_K = 1.9;                                  // zone de détection : 1,9 rayon autour du disque (proportionnelle à sa taille)

/** Vitesse « au bout d'un ressort » : v'' = k (cible − v) − c v'. Peu amorti : élastique. */
class Spring {
  v = 0; a = 0;
  step(target: number, dt: number, k = 38, c = 6.5) {
    this.a += (k * (target - this.v) - c * this.a) * dt;
    this.v += this.a * dt;
    return this.v;
  }
}

/**
 * Le logo : exactement la même réaction au curseur que le disque de l'accueil (même accélération au survol, même ralentissement), avec une zone de détection proportionnelle
 * à sa taille — mais rien ne se déclenche, même en restant longtemps dessus.
 */
export function spinNear(el: HTMLElement) {
  const sp = new Spring();
  let ang = 0, charge = 0, last = performance.now();
  const loop = (now: number) => {
    const dt = Math.max(0, Math.min(0.04, (now - last) / 1000)); last = now;
    if (!reduceMotion && el.isConnected && el.offsetParent) {
      const b = el.getBoundingClientRect(), r = el.offsetWidth / 2;   // taille réelle (la boîte d'un disque tourné est plus grande)
      const n = nearness(b.left + b.width / 2, b.top + b.height / 2, r, r * REACH_K);
      const on = n >= 1;
      charge = on ? Math.min(1, charge + dt * CHARGE_UP) : Math.max(0, charge - dt * 1.5);
      const target = on ? 500 + (MAX - 500) * Math.pow(charge, 1.4) : 520 * n * n;   // pas de rotation de base : immobile tant que le curseur est loin
      let v: number;
      if (target >= sp.v) v = sp.step(target, dt);    // il accélère sous le curseur
      else {                                          // inertie : laissé à lui-même, il continue sur son élan et ralentit lentement (frottement)
        v = Math.max(target, sp.v - (45 + 0.65 * sp.v) * dt);   // s'arrête un peu plus vite (≈ 4 s depuis la pointe)
        sp.v = v; sp.a = 0;
      }
      if (v < 0) { v = 0; sp.v = 0; sp.a = 0; }
      ang = (ang - v * dt) % 360;                     // le logo montre le recto : il tourne en sens antihoraire (le verso, lui, tourne en sens horaire)
      el.style.transform = `rotate(${ang.toFixed(2)}deg)`;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

/** Affiche l'accueil ; se résout quand on entre. */
export function welcome(): Promise<void> {
  return new Promise((resolve) => {
    document.body.classList.add('welcome');
    platine.setNear(0); platine.play('salutations');            // les voix de la Terre qui disent bonjour, à la suite
    const root = document.createElement('div');
    root.className = 'welcome-layer';
    root.innerHTML = `
      <div class="w-disc" role="button" tabindex="0" aria-label="Entrer">
        <div class="w-flip">
          <img class="w-face w-recto" src="/disque/recto-doux.webp" alt="" draggable="false" />
          <img class="w-face w-verso" src="/disque/verso-disque.jpg" alt="" draggable="false" />
          ${Array.from({ length: 13 }, (_, k) => { const z = (k / 12 - 0.5) * 0.9, bulge = 0.55 * (1 - Math.pow(2 * z / 0.9, 2)); return `<div class="w-ep" style="inset: ${(-bulge).toFixed(3)}%; transform: translateZ(calc(var(--ep) * ${z.toFixed(3)}))"></div>`; }).join('')}
        </div>
      </div>`;
    document.body.append(root);
    const disc = root.querySelector('.w-disc') as HTMLElement, flip = root.querySelector('.w-flip') as HTMLElement;
    const sp = new Spring();
    let ang = 0, grow = 1, charge = 0, held = false, phase: 'charge' | 'brake' | 'gone' = 'charge', last = performance.now();
    disc.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'mouse') held = true; });
    const lache = () => { held = false; };
    window.addEventListener('pointerup', lache);
    disc.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); held = true; } });
    disc.addEventListener('keyup', () => { held = false; });
    disc.focus({ preventScroll: true });

    // fin : dès qu'il est lancé à fond, il freine en douceur ET commence à se retourner (recto, verso…)
    // en même temps, sur une courbe lisse au tempo un peu irrégulier ; il disparaît d'un coup pile
    // sur sa tranche, juste après avoir montré le verso.
    const FLIP = 450;                                   // 1 tour ¼ : 360° = recto de face (dernière face vue), 450° = pile sur la tranche
    const DUR = 3700;                                   // retournement plus lent : plus doux pour les yeux
    let fp = 0;                                         // avancement du retournement (0 → 1)
    let committed = false, cp = 0;                      // déclenché (sans retour possible) · avancement depuis le déclenchement
    const done = () => {
      phase = 'gone'; disc.style.visibility = 'hidden';
      // aucun temps mort : le grand disque prend le relais à cet instant précis
      document.body.classList.add('arrivee'); document.body.classList.remove('prechauffe'); window.removeEventListener('pointerup', lache); root.remove(); document.body.classList.remove('welcome'); resolve();
      platine.setNear(1); platine.play('musiques');   // le grand disque : les musiques, au volume habituel
      setTimeout(() => document.body.classList.remove('arrivee'), 3000);
    };
    const flipAt = (p: number) => {
      const e = 0.6 * (1 - Math.pow(1 - p, 2.6) * (1 + 2.6 * p)) + 0.4 * p;   // départ doux, élan, fin lente mais pas arrêtée : le grand disque reprend ce mouvement
      const wob = Math.sin(p * Math.PI * 3) * Math.sin(p * Math.PI) * p * 3;    // petites hésitations du tempo (discrètes)
      return FLIP * e + wob;
    };

    // ─── mode débogage (?debug3d) : ralenti, axes et faces en couleur, valeurs à l'écran ───
    // touches : P pause · + / − vitesse · → image par image (en pause)
    let speed = DEBUG ? 0.2 : 1, paused = false, stepOnce = false, sim = performance.now();
    if (DEBUG) {
      root.classList.add('debug');
      flip.insertAdjacentHTML('beforeend', `
        <div class="dbg-face dbg-recto"><span>RECTO<br>↑ haut</span></div>
        <div class="dbg-face dbg-verso"><span>VERSO<br>↑ haut</span></div>
        <div class="dbg-normal"></div>`);
      disc.insertAdjacentHTML('beforeend', `<div class="dbg-axe dbg-x"></div><div class="dbg-axe dbg-y"></div>`);
      root.insertAdjacentHTML('beforeend', `<pre class="dbg-hud"></pre>`);
      window.addEventListener('keydown', (e) => {
        if (e.key === 'p' || e.key === 'P') paused = !paused;
        else if (e.key === '+') speed = Math.min(1, speed * 1.5);
        else if (e.key === '-') speed = Math.max(0.02, speed / 1.5);
        else if (e.key === 'ArrowRight') { paused = true; stepOnce = true; }
      });
    }
    const hud = root.querySelector('.dbg-hud') as HTMLElement | null;

    let flat = false;
    const loop = (now: number) => {
      if (phase === 'gone') return;
      const realDt = Math.max(0, Math.min(0.04, (now - last) / 1000)); last = now;
      const dt = paused && !stepOnce ? 0 : (stepOnce ? 1 / 60 : realDt * speed); stepOnce = false;
      sim += dt * 1000; now = sim;                   // horloge de l'animation (ralentie ou en pause en débogage)
      const b = disc.getBoundingClientRect(), r = b.width / 2;
      const n = held ? 1 : nearness(b.left + r, b.top + r, r, r * REACH_K)   /* zone de détection réduite : il faut être tout près */;
      if (!committed && charge >= 0.7) committed = true;   // une fois lancé, l'animation va jusqu'au bout, même si on s'éloigne
      const on = held || n >= 1 || committed;
      let v: number;
      if (phase === 'charge') {
        // dessus : accélère vite jusqu'au maximum ; à côté : vitesse selon la distance, sans accélérer
        charge = on ? Math.min(1, charge + dt * CHARGE_UP) : Math.max(0, charge - dt * 1.5);   // montée un peu plus lente
        const target = on ? 500 + (MAX - 500) * Math.pow(charge, 1.4) : BASE + (520 - BASE) * n * n;   // jamais à l'arrêt : rotation minimale = lecture ×1   // jamais à l'arrêt : rotation minimale = lecture ×1
        v = sp.step(target, dt);
        if (v < BASE) { v = BASE; sp.v = BASE; sp.a = Math.max(0, sp.a); }   // jamais sous sa vitesse ×1, même quand on s'éloigne
        if (charge >= 0.9 && v > MAX * 0.75) {           // la vitesse de pointe dure peu : il freine aussitôt
          phase = 'brake';
          if (reduceMotion) { root.remove(); document.body.classList.remove('welcome'); resolve(); phase = 'gone'; platine.setNear(1); platine.play('musiques'); return; }   // comme done() : la musique démarre aussi
        }
      } else {
        v = sp.step(110, dt, 3, 3.6);                   // il ralentit en douceur mais continue de tourner sur lui-même jusqu'au bout (et au-delà de sa disparition)
      }
      // le retournement commence dès qu'il se met à grossir (on s'approche) ; si on s'éloigne tôt, il revient doucement
      if (committed) { cp = Math.min(1, cp + dt / 0.8); if (cp >= 0.75) fp = Math.min(1, fp + dt * 1000 / DUR); }   // il grossit d'abord, puis bascule
      if (fp > 0.7) document.body.classList.add('prechauffe');   // l'interface se prépare (dessinée, invisible) avant la fin   // grossissement et retournement : seulement une fois lancé
      {
        const p = fp, tilt = Math.sin(p * Math.PI * 1.6) * (1 - p) * 5;   // léger balancement hors de l'axe
        flip.style.transform = `rotateY(${tilt.toFixed(2)}deg) rotateX(${(-flipAt(p)).toFixed(2)}deg)`;
        disc.style.setProperty('--flipdeg', (-flipAt(p)).toFixed(1) + 'deg');   // les reflets de la tranche suivent le retournement   // il bascule vers nous
        if (p >= 1) { if (!flat) { flat = true; } else { lastSpin = v; done(); return; } }   // une image exactement à plat, puis on passe la main
      }
      ang = (ang - v * dt) % 360;                     // vu côté verso : sens horaire (comme le grand disque) ; le recto, vu de l'autre côté, tourne donc en sens antihoraire
      platine.setSpeed(1 + 1.6 * Math.pow(Math.min(1, Math.max(0, Math.abs(v) - BASE) / (MAX - BASE)), 1.2));   // comme un vinyle : plus vite, plus aigu
      disc.style.setProperty('--spin', ang.toFixed(2) + 'deg');
      disc.style.setProperty('--near', n.toFixed(3));
      // il s'approche en tournant : il grossit avec l'élan, puis encore pendant qu'il se retourne
      const flipP = fp;
      const growTo = 1 + 0.55 * cp + 1.55 * (1 - Math.pow(1 - flipP, 2));   // il ne grossit qu'une fois lancé, un peu moins qu'avant
      grow += (growTo - grow) * (1 - Math.pow(0.02, dt));
      disc.style.scale = (grow / 4.1).toFixed(4);     // le disque est dessiné à sa taille finale : on le réduit au lieu de l'agrandir (pas de flou)
      platine.setNear((grow - 1) / 2.1);              // plus il est grand (proche), plus il est fort ; au maximum à la fin
      if (hud) {
        const p = fp, rx = -flipAt(p);
        const m = ((rx % 360) + 360) % 360, face = Math.cos(rx * Math.PI / 180) >= 0 ? 'RECTO (rouge)' : 'VERSO (bleu)';
        hud.textContent = `vitesse anim ×${speed.toFixed(2)}${paused ? '  [PAUSE]' : ''}   (P pause · + / − vitesse · → image par image)
phase            ${phase}
retournement     ${(p * 100).toFixed(1)} %
rotateX          ${rx.toFixed(1)}°   (modulo 360 : ${m.toFixed(1)}°)
face attendue    ${face}${Math.abs(Math.cos(rx * Math.PI / 180)) < 0.08 ? '   ← sur la tranche' : ''}
rotation propre  ${ang.toFixed(1)}°   vitesse ${v.toFixed(0)} °/s
échelle          ${(grow / 4.1).toFixed(3)}`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  });
}
