/**
 * Resolves where Hunter persists state on disk.
 *
 * Priority:
 *   1. `HUNTER_DATA_DIR` env (absolute or relative — relative resolves from
 *      cwd, useful for tests). The desktop sidecar sets this to the OS-standard
 *      per-user data directory:
 *        - macOS:  ~/Library/Application Support/Hunter
 *        - Windows: %APPDATA%/Hunter
 *        - Linux:  ~/.local/share/hunter
 *   2. `cwd/data` (dev default — keeps `pnpm dev` behaviour unchanged).
 *
 * Resolving the OS-standard path is intentionally left to the desktop shell
 * rather than baked into the server. The server only needs to honour whatever
 * directory it is pointed at, which keeps unit tests trivial and avoids
 * coupling Node code to platform-specific home-directory logic.
 */

import path from "node:path";

export function resolveDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.HUNTER_DATA_DIR?.trim();
  if (override) return path.resolve(override);
  return path.resolve("data");
}

export function hunterDataPath(filename: string, env?: NodeJS.ProcessEnv): string {
  return path.join(resolveDataDir(env), filename);
}
