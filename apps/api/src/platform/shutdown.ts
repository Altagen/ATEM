/**
 * Clean shutdown.
 *
 * Without it, a redeploy cuts requests in flight: the client gets a closed
 * connection in the middle of a response, and a transaction may stay open on
 * the database side. We stop accepting, let what is running finish, then close.
 */
import { loggableError } from "./errors.js";
type Closer = () => Promise<void> | void;

const closers: Closer[] = [];
let stopping = false;

export function onShutdown(closer: Closer): void {
  closers.push(closer);
}

export function installShutdownHandlers(graceMs = 10_000): void {
  const stop = async (signal: string) => {
    // A second signal during shutdown means “right now”: we obey.
    if (stopping) process.exit(1);
    stopping = true;
    console.log(`[atem] ${signal} received, shutting down…`);

    const deadline = setTimeout(() => {
      console.error(`[atem] shutdown unfinished after ${graceMs} ms, forcing exit`);
      process.exit(1);
    }, graceMs);
    deadline.unref();

    for (const closer of closers.reverse()) {
      try {
        await closer();
      } catch (err) {
        console.error("[atem] failure during shutdown:", loggableError(err));
      }
    }
    clearTimeout(deadline);
    process.exit(0);
  };

  process.on("SIGTERM", () => void stop("SIGTERM"));
  process.on("SIGINT", () => void stop("SIGINT"));
}
