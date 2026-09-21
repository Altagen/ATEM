/**
 * The card back stands in for an artwork that does not come.
 *
 * While an artwork loads, the stylesheets already paint the back behind the
 * `<img>`. What they cannot cover is an image that fails — a card whose
 * artwork is not on the server's disk: the browser would draw its broken-image
 * icon over the back. This puts the back in its place, as ATEM-old did.
 */
import cardBack from "../assets/cards/back.svg";

export function installCardBack(): void {
  // Capture: an image's `error` event does not bubble.
  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!(img instanceof HTMLImageElement)) return;
    if (!img.getAttribute("src")?.startsWith("/media/cards/")) return;
    img.src = cardBack;
  }, true);
}
