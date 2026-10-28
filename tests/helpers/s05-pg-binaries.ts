import fs from "node:fs";
import path from "node:path";

interface BinaryProbe {
  executable(file: string): boolean;
  realpath(file: string): string;
}

const disk: BinaryProbe = {
  executable(file) {
    try { fs.accessSync(file, fs.constants.X_OK); return true; }
    catch { return false; }
  },
  realpath: (file) => fs.realpathSync(file),
};
const REQUIRED = ["initdb", "pg_ctl", "postgres"];
const LEGACY_DIRECTORY = "/usr/lib/postgresql/16/bin";

export function postgresBinariesAvailable(directory: string, probe = disk): boolean {
  return REQUIRED.every((name) => probe.executable(path.join(directory, name)));
}

/** Discovery only: never starts a server or reads database credentials. */
export function discoverPostgresBinDirectory(env: NodeJS.ProcessEnv, probe = disk): string {
  // An explicit override fails closed instead of silently using another version.
  if (env.S05_PG_BIN_DIR !== undefined) return env.S05_PG_BIN_DIR;
  for (const directory of [LEGACY_DIRECTORY, ...(env.PATH ?? "").split(path.delimiter).filter(Boolean)]) {
    if (!postgresBinariesAvailable(directory, probe)) continue;
    try {
      // Nix's PATH entries can be symlinks; select the complete real installation.
      const canonical = path.dirname(probe.realpath(path.join(directory, "initdb")));
      if (postgresBinariesAvailable(canonical, probe)) return canonical;
    } catch { /* A complete executable PATH entry remains usable without realpath. */ }
    return directory;
  }
  return LEGACY_DIRECTORY; // Retain a useful missing-directory diagnostic.
}
