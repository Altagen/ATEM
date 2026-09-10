/**
 * Fige la page derrière une modale.
 *
 * Sans ce verrou, deux barres de défilement cohabitent : celle du panneau
 * ouvert et celle de la page derrière lui. On croit descendre dans la fiche et
 * c'est la collection qui bouge — et en refermant, on ne se retrouve plus où
 * l'on était.
 *
 * **La méthode compte.** Poser `overflow: hidden` sur `<body>` suffit sur un
 * bureau et ne fait rien sur iOS Safari, qui continue de faire défiler la page.
 * On fixe donc le corps à sa position courante et on restaure le défilement à
 * la fermeture — c'est la seule technique qui tient sur les deux.
 *
 * **Le compteur aussi.** Le panneau de filtres et la fiche de carte peuvent
 * être ouverts l'un par-dessus l'autre : refermer le second ne doit pas rendre
 * la page défilable pendant que le premier est encore là.
 */
let depth = 0;
let savedScrollY = 0;

/**
 * La largeur de la barre de défilement, pour ne pas décaler la page.
 *
 * Quand la barre disparaît, la page gagne sa largeur et tout se déplace vers la
 * droite : un sursaut visible à chaque ouverture. On rend cette largeur en
 * rembourrage. Sur mobile la barre est en surimpression et la valeur vaut zéro,
 * ce qui rend le calcul inoffensif.
 */
function scrollbarWidth(): number {
  return window.innerWidth - document.documentElement.clientWidth;
}

export function lockScroll(): void {
  depth += 1;
  if (depth > 1) return;

  savedScrollY = window.scrollY;
  const gap = scrollbarWidth();

  document.body.style.position = "fixed";
  document.body.style.top = `${-savedScrollY}px`;
  document.body.style.left = "0";
  document.body.style.right = "0";
  document.body.style.width = "100%";
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
}

export function unlockScroll(): void {
  if (depth === 0) return;
  depth -= 1;
  if (depth > 0) return;

  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.left = "";
  document.body.style.right = "";
  document.body.style.width = "";
  document.body.style.paddingRight = "";

  // `scrollTo` sans animation : on remet la page là où elle était, sans que
  // l'œil suive un mouvement qu'il n'a pas demandé.
  window.scrollTo({ top: savedScrollY, behavior: "instant" as ScrollBehavior });
}

/**
 * Relâche tout, quel que soit le compte.
 *
 * Un changement de route emporte les modales sans passer par leur fermeture :
 * sans cette remise à zéro, le corps resterait fixé et la page suivante ne
 * défilerait plus du tout.
 */
export function releaseScroll(): void {
  if (depth === 0) return;
  depth = 1;
  unlockScroll();
}
