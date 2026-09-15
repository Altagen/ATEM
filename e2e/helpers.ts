import type { Page } from "@playwright/test";

/**
 * Un compte neuf par épreuve.
 *
 * Les épreuves partagent une instance : réutiliser un compte ferait dépendre
 * chaque résultat de ce que les précédentes y ont laissé, et un échec isolé
 * deviendrait impossible à lire.
 */
export function freshAccount() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    email: `e2e-${stamp}@exemple.test`,
    // Seize caractères et les quatre familles : la règle du serveur, qui est
    // aussi celle que la jauge affiche.
    password: "Mot-De-Passe-Test-7!",
    displayName: `Testeur ${stamp.slice(-4)}`,
  };
}

export async function signUp(page: Page): Promise<ReturnType<typeof freshAccount>> {
  const account = freshAccount();
  await page.goto("/register");
  await page.getByLabel("Pseudo").fill(account.displayName);
  await page.getByLabel("Adresse e-mail").fill(account.email);
  await page.getByLabel("Mot de passe", { exact: false }).first().fill(account.password);
  await page.getByLabel("Confirmation du mot de passe").fill(account.password);
  await page.getByRole("button", { name: "Créer mon compte" }).click();
  await page.waitForURL("**/collection");
  return account;
}

/** Ajoute une carte par son set code, depuis l'écran de collection. */
export async function addBySetCode(page: Page, setCode: string): Promise<void> {
  await page.getByLabel("Ajouter par set code").fill(setCode);
  await page.getByRole("button", { name: "Ajouter la carte" }).click();
  // On attend que la grille ait repris : sans ça, l'assertion suivante peut
  // lire l'état d'avant le rechargement.
  await page.locator(".content").getByText(setCode, { exact: true }).first().waitFor();
}

/**
 * Vérifie que la page ne déborde pas horizontalement.
 *
 * C'est le défaut mobile le plus courant et le plus discret : une grille ou un
 * tableau un peu large, et toute la page se met à glisser latéralement. Ça ne
 * casse rien, ça rend juste l'écran désagréable — et personne ne le voit sur un
 * moniteur de bureau.
 */
export async function expectNoHorizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/**
 * Bascule en vue galerie.
 *
 * La collection s'ouvre en **liste**, comme ATEM-old : c'est là que vivent les
 * boutons « +1 » et « −1 ». La galerie est une vue de consultation, où l'on
 * ouvre la carte pour agir.
 */
export async function useGalleryView(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Vue galerie" }).click();
  await page.locator(".gallery").waitFor();
}
