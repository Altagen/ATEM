/** Les briques d'interface partagées. */

/**
 * Crée un élément et lui pose son contenu par `textContent`.
 *
 * Jamais `innerHTML` avec une donnée : un nom de carte, un pseudo ou un message
 * d'erreur du serveur sont des données, et une seule concaténation oubliée
 * suffit à ouvrir une injection.
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

/** Un seul message à l'écran : le précédent s'efface avant que le suivant paraisse. */
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
 * Un gabarit qui échappe par défaut.
 *
 * Le balisage repris d'ATEM-old est volumineux : l'écrire nœud par nœud le
 * rendrait illisible et intransposable. On assemble donc des chaînes — mais
 * **toute interpolation est échappée**, sans exception à demander.
 *
 * Un nom de carte, un pseudo ou un message d'erreur du serveur sont des
 * données. Une seule concaténation oubliée ouvre une injection, et c'est
 * exactement ce que cette fonction rend impossible : il n'existe pas d'échappée
 * de secours. Ce qui doit passer en HTML passe par `raw()`, qui se voit.
 */
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (c) => ESCAPES[c]!);

/** Marque une chaîne comme du HTML déjà construit, à ne pas ré-échapper. */
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

/** `html` conditionnel : rend le fragment seulement si la condition tient. */
export const when = (condition: unknown, fragment: SafeHtml | string): SafeHtml =>
  condition ? (fragment instanceof SafeHtml ? fragment : raw(fragment)) : raw("");
