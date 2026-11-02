/**
 * S34 follow-up: deploy/backup-ovh-lumiere/lumiere-backup.sh, end to end on a real local PostgreSQL.
 * Dump -> table checks -> age encryption to two recipients -> decrypt-verify -> manifest -> retention -> last-run.json,
 * then the "offline" key restores the backup into a fresh database with identical rows (including an RLS table).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PG_BINARIES_AVAILABLE, PG_BIN_DIR, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

const SCRIPT = path.resolve("deploy/backup-ovh-lumiere/lumiere-backup.sh");
const hasAge = spawnSync("age", ["--version"]).status === 0;

describe.skipIf(!PG_BINARIES_AVAILABLE || !hasAge)("OVH Lumière backup script (real Postgres + age)", () => {
  let pg: LocalPg;
  let dir: string, data: string, creds: string, recipients: string, offlineKey: string;
  let env: NodeJS.ProcessEnv;
  const keygen = (file: string) => { execFileSync("age-keygen", ["-o", file], { stdio: "pipe" }); return execFileSync("age-keygen", ["-y", file]).toString().trim(); };
  const run = (extra: NodeJS.ProcessEnv = {}) => spawnSync("bash", [SCRIPT], { env: { ...env, ...extra }, encoding: "utf8" });
  const lastRun = () => JSON.parse(fs.readFileSync(path.join(data, "last-run.json"), "utf8"));
  const backups = () => fs.readdirSync(data).filter((f) => /^lumiere-portal-.*\.dump\.age$/.test(f)).sort();

  beforeAll(async () => {
    pg = await startLocalPg({ bare: true });
    await pg.sql(`CREATE SCHEMA auth; CREATE SCHEMA storage;
      CREATE TABLE public.users (id text primary key, email text); CREATE TABLE public.students (id text primary key, first_name text, credits numeric);
      CREATE TABLE auth.users (id text primary key, email text); CREATE TABLE storage.objects (id text primary key, name text);
      ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
      INSERT INTO public.users VALUES ('u1','a@example.test'),('u2','b@example.test');
      INSERT INTO public.students VALUES ('s1','Synthetic',3.5),('s2','Élève',7);
      INSERT INTO auth.users VALUES ('u1','a@example.test'); INSERT INTO storage.objects VALUES ('o1','doc.pdf');`);
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lpbackup-"));
    data = path.join(dir, "data"); creds = path.join(dir, "creds"); fs.mkdirSync(creds); fs.mkdirSync(data);
    offlineKey = path.join(dir, "offline.key");
    const offline = keygen(offlineKey);
    const op = keygen(path.join(creds, "agekey"));
    recipients = path.join(dir, "recipients.txt");
    fs.writeFileSync(recipients, `${offline}\n${op}\n`);
    fs.writeFileSync(path.join(creds, "dburl"), `${pg.url}?sslmode=disable`);
    env = { PATH: process.env.PATH, CREDENTIALS_DIRECTORY: creds, LUMIERE_BACKUP_DIR: data, LUMIERE_BACKUP_RECIPIENTS: recipients,
      LUMIERE_PG_BIN: PG_BIN_DIR, LUMIERE_EXPECT_REF: "127.0.0.1" };
  }, 120_000);
  afterAll(async () => { await pg?.stop(); if (dir) fs.rmSync(dir, { recursive: true, force: true }); });

  it("creates one encrypted, verified backup with a manifest and no plaintext left behind", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
    expect(lastRun()).toMatchObject({ status: "PASS", tablesWithData: 4, kept: 1, deleted: 0 });
    const [file] = backups();
    const manifest = JSON.parse(fs.readFileSync(path.join(data, `${file}.json`), "utf8"));
    expect(manifest).toMatchObject({ recipients: 2, schemas: ["public", "auth", "storage"] });
    expect(fs.readdirSync(data).filter((f) => f.startsWith(".work") || f.endsWith(".dump"))).toEqual([]);
    // Ciphertext only: no row content readable in the stored file.
    expect(fs.readFileSync(path.join(data, file!)).includes(Buffer.from("Synthetic"))).toBe(false);
    // The database password never reaches the log output.
    expect(r.stdout + r.stderr).not.toContain("postgres://");
  });

  it("the OFFLINE key alone restores it into a fresh database with identical rows", async () => {
    const [file] = backups();
    const dump = path.join(dir, "restored.dump");
    execFileSync("age", ["-d", "-i", offlineKey, "-o", dump, path.join(data, file!)]);
    await pg.sql(`CREATE DATABASE restored`);
    const target = pg.url.replace(/\/[^/]+$/, "/restored");
    // A fresh database already has schema "public": pg_restore reports that single benign error and restores the rest.
    const rs = spawnSync(path.join(PG_BIN_DIR, "pg_restore"), ["--no-owner", "-d", target, dump], { encoding: "utf8" });
    const errors = rs.stderr.split("\n").filter((l) => l.includes("ERROR:"));
    expect(errors.every((l) => l.includes('schema "public" already exists')), rs.stderr).toBe(true);
    const q = (sql: string) => execFileSync(path.join(PG_BIN_DIR, "psql"), ["-XAt", target, "-c", sql]).toString().trim();
    expect(q(`select string_agg(id||':'||first_name||':'||credits, ',' order by id) from public.students`)).toBe("s1:Synthetic:3.5,s2:Élève:7");
    expect(q(`select count(*) from auth.users`)).toBe("1");
    expect(q(`select count(*) from storage.objects`)).toBe("1");
    expect(q(`select relrowsecurity from pg_class where oid='public.students'::regclass`)).toBe("t");
  });

  it("retention deletes copies older than KEEP_DAYS but always keeps the newest 3", () => {
    const fresh = backups().length;
    const old = new Date(Date.now() - 30 * 86_400_000);
    for (const d of ["20260901T000000Z", "20260902T000000Z", "20260903T000000Z"]) {
      const f = path.join(data, `lumiere-portal-${d}.dump.age`);
      fs.writeFileSync(f, "x"); fs.writeFileSync(`${f}.json`, "{}"); fs.utimesSync(f, old, old);
    }
    expect(run().status).toBe(0);
    const newCount = fresh + 1; // every recent copy is kept
    const oldKept = Math.max(0, 3 - newCount); // old copies survive only to reach the minimum of 3
    expect(lastRun()).toMatchObject({ status: "PASS", kept: newCount + oldKept, deleted: 3 - oldKept });
    expect(backups().filter((f) => f.startsWith("lumiere-portal-202609"))).toHaveLength(oldKept);
    expect(backups().filter((f) => !f.startsWith("lumiere-portal-202609"))).toHaveLength(newCount);
  });

  it("refuses a database URL for another project and records FAIL", () => {
    const r = run({ LUMIERE_EXPECT_REF: "rheronevecsffaejteoj" });
    expect(r.status).toBe(1);
    expect(lastRun()).toMatchObject({ status: "FAIL", error: expect.stringContaining("does not identify project") });
  });

  it("fails (and says why) if a core table is missing from the dump", () => {
    const r = run({ LUMIERE_REQUIRED_TABLES: "public students|public enrollments_missing" });
    expect(r.status).toBe(1);
    expect(lastRun().error).toContain("public enrollments_missing");
  });

  it("fails if only one recipient is configured (offline key must always be included)", () => {
    const one = path.join(dir, "one.txt");
    fs.writeFileSync(one, fs.readFileSync(recipients, "utf8").split("\n")[1] + "\n");
    const r = run({ LUMIERE_BACKUP_RECIPIENTS: one });
    expect(r.status).toBe(1);
    expect(lastRun().error).toContain("offline and the operational key");
  });
});
