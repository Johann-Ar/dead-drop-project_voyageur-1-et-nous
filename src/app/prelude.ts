/**
 * Le pré-accueil : l'histoire de Voyager 1 en quatre temps, sur un seul écran, avec quatre photos
 * d'archives NASA (même cadre, même aspect de vieux tirage). Le bouton « Écouter la Terre » lance
 * l'accueil — et c'est ce clic qui autorise le son.
 * Les photos sont des fichiers du projet (public/prelude/) : tout marche hors ligne.
 */
const ECRANS = [
  { n: '01', titre: 'Le lancement', date: '5 septembre 1977', img: '/prelude/01-lancement.jpg',
    texte: 'Le 5 septembre 1977, la fusée Titan-Centaur s’arrache à la Terre, emportant avec elle notre message vers les étoiles.',
    credit: 'NASA/KSC — lancement de Voyager 1, 5 sept. 1977' },
  { n: '02', titre: 'La sonde Voyager 1', date: '1977', img: '/prelude/02-sonde.jpg',
    texte: 'Conçue pour une odyssée sans précédent, la sonde entame son voyage à travers le système solaire externe.',
    credit: 'NASA/JPL-Caltech — une sonde Voyager en essais, 27 avril 1977' },
  { n: '03', titre: 'Le disque d’or fixé sur sa coque', date: '1977', img: '/prelude/03-disque.jpg',
    texte: 'Sur son flanc, elle porte le Golden Record, une bouteille à la mer cosmique contenant les sons et les images de notre monde.',
    credit: 'NASA/JPL-Caltech — pose du couvercle du disque d’or, 1977' },
  { n: '04', titre: 'Aujourd’hui, l’espace interstellaire', date: 'depuis 2012', img: '/prelude/04-point-bleu.jpg',
    texte: 'Depuis 2012, Voyager 1 vogue dans le vide de l’espace interstellaire, devenant l’objet humain le plus éloigné de la Terre.',
    credit: 'NASA/JPL — la Terre, « point bleu pâle », vue par Voyager 1 (1990)' },
];

/** Affiche le pré-accueil ; se résout au clic sur « Écouter la Terre ». */
export function prelude(): Promise<void> {
  return new Promise((resolve) => {
    const root = document.createElement('section');
    root.className = 'prelude';
    root.setAttribute('aria-label', 'Voyager 1, en quatre temps');
    root.innerHTML = `
      <header class="p-titre"><span class="word">VOYAGEUR 1</span><span class="sous-titre">Et nous</span></header>
      <ol class="p-ecrans">
        ${ECRANS.map((e) => `
        <li class="p-ecran">
          <figure class="p-tirage"><img src="${e.img}" alt="" decoding="async" /><figcaption>${e.credit}</figcaption></figure>
          <h2><span class="p-n">${e.n}</span>${e.titre}</h2>
          <p>${e.texte}</p>
        </li>`).join('')}
      </ol>
      <button class="p-ecouter" type="button"><span>Écouter la Terre</span></button>`;
    // photo absente (pas encore téléchargée) : le cadre reste, vide et sombre
    for (const img of root.querySelectorAll('img')) img.addEventListener('error', () => img.classList.add('absente'));
    document.body.append(root);
    const btn = root.querySelector('.p-ecouter') as HTMLButtonElement;
    btn.focus({ preventScroll: true });
    btn.addEventListener('click', () => {
      btn.disabled = true;
      root.classList.add('part');                 // tout s'efface, puis l'accueil commence
      setTimeout(() => { root.remove(); resolve(); }, 1100);
    }, { once: true });
  });
}
