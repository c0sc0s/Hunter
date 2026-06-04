/**
 * Port selection + bind logic for the Hunter API.
 *
 * Two modes:
 *   - Single port: respects PORT env (default 4317). Bind failure throws.
 *   - Range mode: HUNTER_PORT_RANGE="start-end" (e.g. "4317-4319"). Tries
 *     ports in order; the first one that binds wins. Used when the server is
 *     launched as a desktop sidecar so a stray local process holding 4317
 *     doesn't kill the desktop app.
 *
 * On successful bind we emit two log lines:
 *   - `HUNTER_API_PORT=<port>` (single line, machine-parseable, used by the
 *     Electron supervisor to discover the chosen port via stdout)
 *   - `Hunter API listening on http://127.0.0.1:<port>` (human-readable, kept
 *     for dev experience continuity)
 *
 * On exhaustion: log `HUNTER_API_PORT_EXHAUSTED` and reject with a typed
 * error. The caller decides whether to exit the process.
 */

import type { Express } from "express";
import type { Server } from "node:http";

/**
 * Build the ordered list of candidate ports from process env. Pure function so
 * it can be unit-tested without touching the network.
 */
export function parsePortPreferences(env: NodeJS.ProcessEnv): number[] {
  const range = env.HUNTER_PORT_RANGE?.trim();
  if (range) {
    const match = /^(\d{1,5})-(\d{1,5})$/.exec(range);
    if (!match) {
      throw new Error(`HUNTER_PORT_RANGE must be "start-end" (got "${range}")`);
    }
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start <= 0 || end < start) {
      throw new Error(`HUNTER_PORT_RANGE invalid range: ${start}-${end}`);
    }
    // Cap the range to avoid accidentally scanning the whole port space.
    if (end - start > 32) {
      throw new Error(`HUNTER_PORT_RANGE span > 32 ports (${start}-${end}) not allowed`);
    }
    const ports: number[] = [];
    for (let p = start; p <= end; p += 1) ports.push(p);
    return ports;
  }

  const single = Number(env.PORT ?? 4317);
  if (!Number.isFinite(single) || single <= 0 || single > 65535) {
    throw new Error(`PORT must be a valid port number (got "${env.PORT}")`);
  }
  return [single];
}

export class PortExhaustedError extends Error {
  readonly tried: readonly number[];
  constructor(tried: readonly number[]) {
    super(`HUNTER_API_PORT_EXHAUSTED: tried ${tried.join(", ")}`);
    this.name = "PortExhaustedError";
    this.tried = tried;
  }
}

/**
 * Attempt to listen on each port in order. The first port that binds
 * successfully wins; EADDRINUSE on a port causes us to try the next one.
 * Any other error (EACCES, EAFNOSUPPORT, etc.) aborts immediately.
 */
export async function listenOnFirstAvailable(
  app: Express,
  ports: readonly number[],
  host = "127.0.0.1"
): Promise<{ port: number; server: Server }> {
  for (const port of ports) {
    try {
      const server = await new Promise<Server>((resolve, reject) => {
        const s = app.listen(port, host);
        const onError = (err: NodeJS.ErrnoException) => {
          s.off("listening", onListening);
          // Close in case partial bind state lingers; safe on most platforms.
          try {
            s.close();
          } catch {
            // ignore
          }
          reject(err);
        };
        const onListening = () => {
          s.off("error", onError);
          resolve(s);
        };
        s.once("error", onError);
        s.once("listening", onListening);
      });
      return { port, server };
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EADDRINUSE") continue;
      throw err;
    }
  }
  throw new PortExhaustedError(ports);
}

/**
 * Bind the Express app and emit the sidecar handshake on stdout.
 */
export async function bindAndAnnounce(app: Express, env: NodeJS.ProcessEnv = process.env): Promise<{ port: number; server: Server }> {
  const ports = parsePortPreferences(env);
  try {
    const result = await listenOnFirstAvailable(app, ports);
    process.stdout.write(`HUNTER_API_PORT=${result.port}\n`);
    console.log(`Hunter API listening on http://127.0.0.1:${result.port}`);
    return result;
  } catch (err) {
    if (err instanceof PortExhaustedError) {
      process.stderr.write(`HUNTER_API_PORT_EXHAUSTED tried=${err.tried.join(",")}\n`);
    }
    throw err;
  }
}
