/** The shared interface building blocks. */

/**
 * Creates an element and sets its content through `textContent`.
 *
 * Never `innerHTML` with data: a card name, a display name or a server error
 * message are data, and a single forgotten concatenation is enough to open an
 * injection.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else node.setAttribute(key, value);
  }
  for (const child of children) {
    node.append(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

let currentToast: HTMLElement | null = null;

/** One message on screen at a time: the previous one goes before the next appears. */
export function toast(message: string, kind: "info" | "error" | "success" = "info"): void {
  currentToast?.remove();
  const node = el("div", { class: "toast", role: "status", "data-kind": kind }, [message]);
  document.body.append(node);
  currentToast = node;
  setTimeout(() => {
    if (currentToast === node) {
      node.remove();
      currentToast = null;
    }
  }, 3200);
}

/**
 * A template that escapes by default.
 *
 * The markup taken from the earlier prototype is bulky: writing it node by node would make
 * it unreadable and impossible to transpose. So we assemble strings — but
 * **every interpolation is escaped**, with no exception to ask for.
 *
 * A card name, a display name or a server error message are data. A single
 * forgotten concatenation opens an injection, and that is exactly what this
 * function makes impossible: there is no escape hatch. What must go through as
 * HTML goes through `raw()`, which is visible.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Marks a string as HTML already built, not to be escaped again. */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

export const raw = (value: string): SafeHtml => new SafeHtml(value);

export function html(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  let out = strings[0] ?? "";
  for (let i = 0; i < values.length; i += 1) {
    const value = values[i];
    if (value instanceof SafeHtml) out += value.value;
    else if (Array.isArray(value)) {
      out += value.map((v) => (v instanceof SafeHtml ? v.value : escapeHtml(String(v)))).join("");
    } else if (value === null || value === undefined || value === false) out += "";
    else out += escapeHtml(String(value));
    out += strings[i + 1] ?? "";
  }
  return new SafeHtml(out);
}

/**
 * Conditional `html`: renders the fragment only if the condition holds.
 *
 * It accepts `SafeHtml` only. It used to accept a plain string too, which it
 * passed to `raw()` — hence as trusted HTML, unescaped. No caller used it that
 * way, but it was exactly the escape hatch this file claims not to have, and it
 * did not show: `when(x, name)` looks harmless. What must go through as HTML
 * goes through `raw()`, which is visible.
 */
export const when = (condition: unknown, fragment: SafeHtml): SafeHtml =>
  condition ? fragment : raw("");
