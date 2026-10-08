/**
 * Le fond spatial.
 * - Fond : noir, avec des poussières et de fins défauts, comme sur les photos du disque — et
 *   comme un ciel. Peint une seule fois dans une image (aucun coût pendant l'animation).
 */

export function paintSpace() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const W = Math.min(2600, Math.round(screen.width * dpr)), H = Math.min(1800, Math.round(screen.height * dpr));
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  let s = 20261001; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#050505'; g.fillRect(0, 0, W, H);
  // poussières : très fines et nombreuses, de tailles et d'éclats variés (aucune grosse tache)
  const n = Math.round((W * H) / 1400);
  for (let i = 0; i < n; i++) {
    const a = Math.pow(r(), 3.2) * 0.55 + 0.02, x = r() * W, y = r() * H;
    const t = r();
    g.fillStyle = t > 0.8 ? `rgba(255,236,200,${a})` : t > 0.65 ? `rgba(205,220,255,${a * 0.8})` : `rgba(235,232,225,${a})`;
    const sz = (r() > 0.97 ? 0.9 + r() * 0.5 : 0.35 + r() * 0.5) * dpr;
    g.fillRect(x, y, sz, sz);
    if (r() > 0.992) { g.fillRect(x - sz * 1.5, y + sz * 0.3, sz * 4, sz * 0.25); g.fillRect(x + sz * 0.3, y - sz * 1.5, sz * 0.25, sz * 4); }   // rares éclats en croix, très fins
  }
  // fibres et rayures, à peine visibles
  g.lineCap = 'round';
  for (let i = 0; i < 9; i++) {
    const x = r() * W, y = r() * H, L = (i < 6 ? 12 + r() * 50 : 90 + r() * 220) * dpr, ang = r() * Math.PI * 2;
    g.strokeStyle = `rgba(230,225,210,${0.03 + r() * 0.05})`; g.lineWidth = (0.25 + r() * 0.3) * dpr;
    g.beginPath(); g.moveTo(x, y);
    g.quadraticCurveTo(x + Math.cos(ang + 0.6) * L * 0.5, y + Math.sin(ang + 0.6) * L * 0.5, x + Math.cos(ang) * L, y + Math.sin(ang) * L);
    g.stroke();
  }
  c.toBlob((b) => {
    if (!b) return;
    document.documentElement.style.setProperty('--space', `url(${URL.createObjectURL(b)})`);
    document.body.classList.add('space');
  }, 'image/jpeg', 0.9);
}

/**
 * Le ciel vit, à peine : quelques points de lumière scintillent très lentement par-dessus le fond fixe
 * (qui garde sa texture fine). Points nets, sans flou ni halo baveux ; 24 images/s seulement, arrêté
 * quand l'onglet est caché ou que les animations sont réduites.
 */
export function twinkle() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const c = document.createElement('canvas'); c.className = 'scintille'; c.setAttribute('aria-hidden', 'true');
  document.body.prepend(c);
  const g = c.getContext('2d')!;
  let W = 0, H = 0, dpr = 1;
  let s = 19770905; const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  type Star = { x: number; y: number; z: number; a: number; f: number; p: number; col: string };
  let stars: Star[] = [];
  const size = () => {
    dpr = Math.min(devicePixelRatio || 1, 2); W = c.width = Math.round(innerWidth * dpr); H = c.height = Math.round(innerHeight * dpr);
    s = 19770905; const n = Math.round(innerWidth * innerHeight / 9000);
    stars = Array.from({ length: n }, () => {
      const t = r();
      return { x: r(), y: r(), z: r() < 0.9 ? 0.55 + r() * 0.5 : 1.1 + r() * 0.5, a: 0.22 + Math.pow(r(), 2) * 0.6, f: 0.08 + r() * 0.22, p: r() * Math.PI * 2,
        col: t > 0.82 ? '255,238,206' : t > 0.66 ? '212,224,255' : '242,240,234' };
    });
  };
  size(); addEventListener('resize', size);
  let last = 0;
  const frame = (now: number) => {
    requestAnimationFrame(frame);
    if (document.hidden || now - last < 41) return; last = now;
    const t = now / 1000, drift = t * 0.6 * dpr;      // dérive à peine perceptible (≈ 1 px toutes les 2 s)
    g.clearRect(0, 0, W, H);
    for (const st of stars) {
      const k = 0.5 + 0.5 * Math.sin(t * st.f * Math.PI * 2 + st.p);
      const a = st.a * (0.25 + 0.75 * k * k);           // scintillement lent, jamais tout à fait éteint
      const x = (st.x * W + drift * st.z) % W, y = st.y * H, z = st.z * dpr;
      g.fillStyle = `rgba(${st.col},${a.toFixed(3)})`;
      g.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(z)), Math.max(1, Math.round(z)));   // un point net, aligné sur les pixels
      if (st.z > 1.1 && k > 0.85) {                     // les plus brillants : une très fine croix au sommet de l'éclat
        g.fillStyle = `rgba(${st.col},${(a * 0.35 * (k - 0.85) / 0.15).toFixed(3)})`;
        g.fillRect(Math.round(x) - 2 * dpr, Math.round(y), 5 * dpr, 1); g.fillRect(Math.round(x), Math.round(y) - 2 * dpr, 1, 5 * dpr);
      }
    }
  };
  requestAnimationFrame(frame);
}
