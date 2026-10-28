import { describe, expect, it } from "vitest";
import { discoverPostgresBinDirectory, postgresBinariesAvailable } from "./helpers/s05-pg-binaries";

function installation(directories: string[], aliases: Record<string, string> = {}) {
  const files = new Set(directories.flatMap((dir) => ["initdb", "pg_ctl", "postgres"].map((bin) => `${dir}/${bin}`)));
  return { executable: (file: string) => files.has(file), realpath: (file: string) => aliases[file] ?? file };
}

describe("disposable PostgreSQL binary discovery", () => {
  it("retains an explicit override without falling back when it is invalid", () => {
    const probe = installation(["/available"]);
    expect(discoverPostgresBinDirectory({ S05_PG_BIN_DIR: "/missing", PATH: "/available" }, probe)).toBe("/missing");
    expect(postgresBinariesAvailable("/missing", probe)).toBe(false);
  });
  it("preserves the complete legacy installation", () => {
    expect(discoverPostgresBinDirectory({ PATH: "/other" }, installation(["/usr/lib/postgresql/16/bin", "/other"]))).toBe("/usr/lib/postgresql/16/bin");
  });
  it("finds Nix binaries through PATH and resolves the real installation", () => {
    const probe = installation(["/runtime/bin", "/nix/pg16/bin"], { "/runtime/bin/initdb": "/nix/pg16/bin/initdb" });
    expect(discoverPostgresBinDirectory({ PATH: "/missing:/runtime/bin" }, probe)).toBe("/nix/pg16/bin");
  });
  it("rejects an incomplete installation", () => {
    expect(postgresBinariesAvailable("/partial", { executable: (file) => file.endsWith("/initdb"), realpath: (file) => file })).toBe(false);
  });
  it("reports missing binaries without starting anything", () => {
    const probe = installation([]);
    const directory = discoverPostgresBinDirectory({ PATH: "/missing" }, probe);
    expect(postgresBinariesAvailable(directory, probe)).toBe(false);
  });
});
