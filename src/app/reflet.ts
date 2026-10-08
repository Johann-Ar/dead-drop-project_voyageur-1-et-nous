/**
 * Le reflet doré au survol, identique partout : la même bande d'or, la même durée, la même courbe
 * que sur le titre. Le texte le reçoit par la feuille de style (dégradé découpé dans les lettres) ;
 * les icônes (traits SVG) reçoivent ici exactement le même dégradé, qui glisse de gauche à droite.
 */
const DUR = 1250;
const ease = (t: number) => {            // ≈ cubic-bezier(.35, .1, .25, 1), comme le texte
  const u = 1 - t; return 1 - u * u * u * (1 - 0.35 * t);
};
let uid = 0;

function prepare(svg: SVGSVGElement) {
  if (svg.dataset.reflet) return svg.dataset.reflet;
  const id = 'reflet-' + (++uid), ns = 'http://www.w3.org/2000/svg';
  const defs = document.createElementNS(ns, 'defs');
  const g = document.createElementNS(ns, 'linearGradient');
  g.setAttribute('id', id); g.setAttribute('gradientUnits', 'userSpaceOnUse');
  g.setAttribute('x1', '-36'); g.setAttribute('y1', '0'); g.setAttribute('x2', '0'); g.setAttribute('y2', '0');
  // mêmes arrêts que le dégradé du texte (bande fine : ambre, or, cœur blanc)
  for (const [o, c] of [[0, 'var(--lumiere)'], [0.445, 'var(--lumiere)'], [0.473, '#b9862c'], [0.484, '#f0bd52'], [0.494, '#fff3cf'], [0.5, '#ffffff'], [0.506, '#fff3cf'], [0.516, '#f0bd52'], [0.527, '#b9862c'], [0.555, 'var(--lumiere)'], [1, 'var(--lumiere)']] as const) {
    const s = document.createElementNS(ns, 'stop'); s.setAttribute('offset', String(o)); s.setAttribute('style', `stop-color: ${c}`); g.append(s);
  }
  defs.append(g); svg.prepend(defs);
  svg.dataset.reflet = id;
  return id;
}

function sweep(el: Element) {
  const svgs = [...el.querySelectorAll('svg')] as SVGSVGElement[];
  for (const svg of svgs) {
    if (getComputedStyle(svg).opacity === '0') continue;
    const id = prepare(svg), g = svg.querySelector('#' + id)!;
    const t0 = performance.now(), tok = String(t0);
    svg.dataset.balayage = tok;   // un nouveau survol remplace le balayage en cours (pas de coupure nette)
    svg.style.stroke = `url(#${id})`;
    const step = (now: number) => {
      if (svg.dataset.balayage !== tok) return;
      const k = Math.min(1, (now - t0) / DUR), x = -48 + 96 * ease(k);       // la bande traverse l'icône de gauche à droite
      g.setAttribute('x1', String(x - 30)); g.setAttribute('y1', '-9'); g.setAttribute('x2', String(x + 30)); g.setAttribute('y2', '33');   // en diagonale, comme sur le texte
      if (k < 1) requestAnimationFrame(step); else svg.style.stroke = '';
    };
    requestAnimationFrame(step);
  }
}

/** Branche le reflet sur les icônes de ces éléments. */
export function refletIcones(selector: string) {
  for (const el of document.querySelectorAll(selector)) el.addEventListener('pointerenter', () => sweep(el));
}
