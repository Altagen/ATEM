/**
 * Keeping the keyboard inside an open window.
 *
 * Five surfaces declare `aria-modal="true"` — the scanner, the account sheet,
 * the card sheet, the deck window, the filter panel — and not one of them held
 * the focus. `Escape` closed, the backdrop closed, but pressing Tab walked out
 * of the window and into the page behind it: you were then typing into a form
 * you could not see, under a backdrop that was still there. For someone
 * navigating by keyboard, or with a screen reader, the window simply leaked.
 *
 * **One trap for all of them, installed once.** Not five implementations to
 * keep in step, and nothing for a sixth window to remember: it works because the
 * window says `role="dialog" aria-modal="true"`, which it has to say anyway.
 *
 * It is driven by the DOM rather than by each screen calling open/close,
 * because these screens repaint by rewriting their markup: the dialog element
 * is a **new node** after every keystroke that triggers a render. A trap
 * holding on to the node it was given would let go on the first repaint, which
 * is exactly when nobody is watching.
 */

/**
 * What can take the focus.
 *
 * `:not([disabled])` and the negative `tabindex` matter: both appear in these
 * windows — a disabled “Add”, a container made programmatically focusable — and
 * counting them would send Tab to something that cannot receive it, which reads
 * as the trap being broken.
 */
const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

/** Laid out and painted — false for `display: none`, true for `position: fixed`. */
const isShown = (element: HTMLElement): boolean => element.getClientRects().length > 0;

/** The window on top: the last one in document order, when several are open. */
function openDialog(): HTMLElement | null {
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]');
  for (let index = dialogs.length - 1; index >= 0; index -= 1) {
    const dialog = dialogs[index];
    // A window kept in the markup but hidden is not open.
    //
    // `getClientRects()`, not `offsetParent`: the latter is **null for a
    // `position: fixed` element**, which every window here is — so that version
    // of this check found no dialog at all and the trap never engaged. Measured,
    // not reasoned: the first Tab walked straight out.
    if (dialog && isShown(dialog)) return dialog;
  }
  return null;
}

const focusableIn = (dialog: HTMLElement): HTMLElement[] =>
  [...dialog.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => isShown(element) || element === document.activeElement,
  );

/**
 * Where the focus was before the window opened, to give it back on closing.
 *
 * Without this, closing a window drops the focus on `<body>`: the next Tab
 * starts again from the top of the page, far from the button that opened it.
 */
let returnTo: HTMLElement | null = null;

function onDialogOpened(dialog: HTMLElement): void {
  // A screen aimed first — the deck window puts the cursor in its name field,
  // deliberately, because you opened it to type. We do not overrule that.
  if (dialog.contains(document.activeElement)) return;

  returnTo = document.activeElement instanceof HTMLElement ? document.activeElement : null;

  /**
   * The container, **never the first field it happens to contain**.
   *
   * Focusing a text input raises the keyboard on a phone, over a window nobody
   * asked to type in — the defect Ange reported on the collection, and the one
   * the scanner had before it. A window that needs the cursor somewhere says so
   * itself, and the line above leaves it alone.
   */
  if (!dialog.hasAttribute("tabindex")) dialog.setAttribute("tabindex", "-1");
  dialog.focus({ preventScroll: true });
}

function onDialogsClosed(): void {
  const target = returnTo;
  returnTo = null;
  if (target && document.contains(target)) target.focus({ preventScroll: true });
}

export function installFocusTrap(): void {
  let wasOpen = false;

  /**
   * Tab is intercepted at the **capture** phase.
   *
   * A screen listening for `keydown` on `document` would otherwise see it first
   * and could move the focus before us; the order between two listeners on the
   * same target is registration order, which nothing here guarantees.
   */
  document.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Tab") return;
      const dialog = openDialog();
      if (!dialog) return;

      const focusable = focusableIn(dialog);
      if (focusable.length === 0) {
        // A window with nothing to focus keeps the focus all the same: letting
        // Tab through would drop it on the page behind.
        event.preventDefault();
        dialog.focus({ preventScroll: true });
        return;
      }

      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const active = document.activeElement;

      // Coming from outside the window — the container itself, typically — Tab
      // enters it rather than continuing through the page.
      if (!dialog.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    },
    true,
  );

  /**
   * Windows appear and disappear through a repaint, not through a call, so the
   * DOM is what we watch. `subtree` is required: they are nested deep inside
   * the screen that renders them.
   */
  const observer = new MutationObserver(() => {
    const dialog = openDialog();
    if (dialog && !wasOpen) onDialogOpened(dialog);
    else if (!dialog && wasOpen) onDialogsClosed();
    wasOpen = dialog !== null;
  });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true });
}
