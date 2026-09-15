/**
 * Freezes the page behind a modal.
 *
 * Without this lock, two scrollbars coexist: the open panel's and the page's
 * behind it. You think you are scrolling down the card sheet and it is the
 * collection that moves — and on closing, you no longer find yourself where you
 * were.
 *
 * **The method matters.** Setting `overflow: hidden` on `<body>` is enough on a
 * desktop and does nothing on iOS Safari, which keeps scrolling the page. So we
 * fix the body at its current position and restore the scroll on closing — the
 * only technique that holds on both.
 *
 * **The counter matters too.** The filter panel and the card sheet can be open
 * one on top of the other: closing the second must not make the page scrollable
 * while the first is still there.
 */
let depth = 0;
let savedScrollY = 0;

/**
 * The scrollbar's width, so the page does not shift.
 *
 * When the bar disappears, the page gains its width and everything moves to the
 * right: a visible jump at every opening. We give that width back as padding.
 * On mobile the bar is an overlay and the value is zero, which makes the
 * computation harmless.
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

  // `scrollTo` without animation: we put the page back where it was, without
  // the eye following a movement it did not ask for.
  window.scrollTo({ top: savedScrollY, behavior: "instant" as ScrollBehavior });
}

/**
 * Releases everything, whatever the count.
 *
 * A route change carries the modals away without going through their closing:
 * without this reset, the body would stay fixed and the next page would not
 * scroll at all.
 */
export function releaseScroll(): void {
  if (depth === 0) return;
  depth = 1;
  unlockScroll();
}
