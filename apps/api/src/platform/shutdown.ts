/**
 * L'arrêt propre.
 *
 * Sans lui, un redéploiement coupe les requêtes en vol : le client reçoit une
 * connexion fermée au milieu d'une réponse, et une transaction peut rester
 * ouverte côté base. On cesse d'accepter, on laisse finir, puis on ferme.
 */
type Closer = () => Promise<void> | void;

const closers: Closer[] = [];
let stopping = false;

export function onShutdown(closer: Closer): void {
  closers.push(closer);
}

export function installShutdownHandlers(graceMs = 10_000): void {
  const stop = async (signal: string) => {
    // Un second signal pendant l'arrêt veut dire « tout de suite » : on obéit.
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[atem] ${signal} reçu, arrêt en cours…`);

    const deadline = setTimeout(() => {
      console.error(`[atem] arrêt non terminé après ${graceMs} ms, sortie forcée`);
      process.exit(1);
    }, graceMs);
    deadline.unref();

    for (const closer of closers.reverse()) {
      try {
        await closer();
      } catch (err) {
        console.error("[atem] échec pendant l'arrêt :", err);
      }
    }
    clearTimeout(deadline);
    process.exit(0);
  };

  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
