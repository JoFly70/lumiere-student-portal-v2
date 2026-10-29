/**
 * S26 — bounded real HOSTED acceptance journey for the already-provisioned SYNTHETIC demo student.
 *
 *   npx tsx scripts/s26/production-acceptance.ts --base https://lumiere-student-portal-v2.replit.app --ref rheronevecsffaejteoj
 *
 * Run inside the production Replit Shell (env: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY,
 * DATABASE_URL) AFTER the new build is published. Options:
 *   --out <dir>          evidence directory (default s26-evidence)
 *   --api-budget <n>     max /api requests per sliding 15-minute window (default 90; the server allows 100)
 *   --skip-browser       skip the Chromium screenshots
 *   --skip-ai            skip the Owner AI and student assistant calls
 *   --ai-only            admin session + read-only admin checks + Owner AI checks only (no writes anywhere)
 *   --allow-ai-unavailable  accept mode "unavailable" (only for deployments where Spark is deliberately off)
 *
 * Writes <out>/acceptance.json (always, also on failure/interrupt), <out>/shots/*.jpg and
 * <out>/shots-b64/<name>.<n>.txt (base64, chunks of at most 90000 characters).
 * Exit code 0 only if every REQUIRED check is PASS.
 *
 * Safety:
 *  - No email is ever sent: the ADMIN session uses generateLink + verifyOtp (no mail); the demo student
 *    uses its real password through POST /api/auth/login.
 *  - Evidence contains no token, password, signed URL or e-mail (e-mails are masked as [email]).
 *  - Every artifact it creates is titled "DEMO". The admin browser blocks every non-GET /api request
 *    (except /api/auth/refresh), so the read-only preview cannot write.
 *  - The server limits /api to 100 requests / 15 min / IP. All HTTP and browser traffic goes through one
 *    sliding-window budget and waits (it prints progress) rather than hitting 429.
 *  - The ADMIN supabase session is signed out with scope "local" only (the owner's other sessions are
 *    untouched). The student's app logout (which revokes all of the DEMO student's sessions) runs last.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import WebSocket from "ws";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// ---------------------------------------------------------------------------------------------
// Constants (mirrors scripts/s26/provision-demo-student.ts; not imported because that file runs on import)
// ---------------------------------------------------------------------------------------------
const DEMO_STUDENT_EMAIL = "s26.demo.student@lumiere-demo.invalid";
const DEMO_PREFERRED = "DEMO-S26-FR";
const DEMO_SECOND_PREFERRED = "DEMO-S26-SECOND";
const DEMO_TAG_PREFIX = "DEMO / SYNTHETIC";
const CRED_FILE = ".s26-private-backup/demo-student-login.txt";
const REQUEST_TIMEOUT_MS = 20_000;
/** Owner AI calls: the server gives the provider up to 30 s plus context loading. */
const OWNER_AI_TIMEOUT_MS = 90_000;
const SERVER_WINDOW_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
function arg(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] ?? null : null;
}
const has = (name: string) => process.argv.includes(name);
if (has("--help") || has("-h")) {
  console.log("usage: npx tsx scripts/s26/production-acceptance.ts --base <https://host> --ref <supabase-ref> [--out s26-evidence] [--api-budget 90] [--skip-browser] [--skip-ai]");
  process.exit(0);
}
const BASE = (arg("--base") ?? "").replace(/\/+$/, "");
const REF = arg("--ref") ?? "";
const OUT = arg("--out") ?? "s26-evidence";
const API_BUDGET = Math.max(5, Math.min(98, Number(arg("--api-budget") ?? 90) || 90));
const SKIP_BROWSER = has("--skip-browser");
const SKIP_AI = has("--skip-ai");
/** Only the admin session, read-only admin checks and the Owner AI checks: no student, document, support or billing writes. */
const AI_ONLY = has("--ai-only");
/** Spark is activated: "unavailable" or any fallback is a FAIL unless this explicit opt-out is passed. */
const ALLOW_AI_UNAVAILABLE = has("--allow-ai-unavailable");
const EXPECTED_MODEL = "muse-spark-1.3-contributor";

// ---------------------------------------------------------------------------------------------
// Scrubbing: nothing secret / personal may reach the evidence file or the console
// ---------------------------------------------------------------------------------------------
const secrets = new Set<string>();
const addSecret = (v: unknown) => { if (typeof v === "string" && v.length >= 8) secrets.add(v); };
const EMAIL_G = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_G = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*/g;
const SIGNED_G = /https?:\/\/[^\s"'<>)\\]*(?:token=|signature=|\/storage\/v1\/|X-Amz-)[^\s"'<>)\\]*/gi;
function scrub(input: string): string {
  let s = String(input);
  for (const secret of secrets) if (secret && s.includes(secret)) s = s.split(secret).join("[secret]");
  return s.replace(SIGNED_G, "[signed-url]").replace(JWT_G, "[token]").replace(EMAIL_G, "[email]");
}
const short = (s: unknown, n = 160) => scrub(String(s ?? "")).replace(/\s+/g, " ").slice(0, n);
const sha8 = (s: string) => crypto.createHash("sha256").update(s).digest("hex").slice(0, 8);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const log = (m: string) => process.stderr.write(`${scrub(m)}\n`);

// ---------------------------------------------------------------------------------------------
// Evidence
// ---------------------------------------------------------------------------------------------
type Result = "PASS" | "FAIL" | "SKIPPED";
interface CheckRecord {
  id: string;
  group: string;
  required: boolean;
  result: Result;
  status?: number | string | Record<string, unknown>;
  detail: string;
  observed?: Record<string, unknown>;
}
const evidence: {
  script: string;
  startedAt: string;
  finishedAt: string | null;
  base: string;
  ref: string;
  verdict: "PASS" | "FAIL" | "INCOMPLETE";
  summary: Record<string, number>;
  ids: Record<string, string | null>;
  rateLimit: Record<string, unknown>;
  checks: CheckRecord[];
  browser: Record<string, unknown>;
  notes: string[];
  /** Spark served-model verification from the provider's own report: PASS / FAIL / NOT_VERIFIED. */
  aiModelVerification: "PASS" | "FAIL" | "NOT_VERIFIED";
  /** Live Spark functionality (status live + English answer + French draft with valid citations): PASS / FAIL / NOT_RUN. */
  aiFunctional: "PASS" | "FAIL" | "NOT_RUN";
  /** Requested-model evidence from the response (S27+ builds): PASS / FAIL / NOT_VERIFIED. */
  aiModelRequested: "PASS" | "FAIL" | "NOT_VERIFIED";
} = {
  script: "scripts/s26/production-acceptance.ts",
  startedAt: new Date().toISOString(),
  finishedAt: null,
  base: BASE,
  ref: REF,
  verdict: "INCOMPLETE",
  summary: {},
  ids: {},
  rateLimit: {},
  checks: [],
  browser: {},
  aiModelVerification: "NOT_VERIFIED",
  aiFunctional: "NOT_RUN",
  aiModelRequested: "NOT_VERIFIED",
  notes: [],
};

function summarize() {
  const req = evidence.checks.filter((c) => c.required);
  evidence.summary = {
    total: evidence.checks.length,
    required: req.length,
    requiredPass: req.filter((c) => c.result === "PASS").length,
    requiredFail: req.filter((c) => c.result === "FAIL").length,
    requiredSkipped: req.filter((c) => c.result === "SKIPPED").length,
    optionalPass: evidence.checks.filter((c) => !c.required && c.result === "PASS").length,
    optionalFail: evidence.checks.filter((c) => !c.required && c.result === "FAIL").length,
    optionalSkipped: evidence.checks.filter((c) => !c.required && c.result === "SKIPPED").length,
  };
}
function persist() {
  try {
    summarize();
    fs.mkdirSync(OUT, { recursive: true });
    const text = scrub(JSON.stringify(evidence, null, 2));
    fs.writeFileSync(path.join(OUT, "acceptance.json"), text + "\n", { mode: 0o600 });
  } catch (e) {
    process.stderr.write(`could not write evidence: ${(e as Error).message}\n`);
  }
}

interface Out {
  ok: boolean;
  skip?: string;
  status?: number | string | Record<string, unknown>;
  detail?: string;
  observed?: Record<string, unknown>;
}
async function run(id: string, group: string, required: boolean, fn: () => Promise<Out>): Promise<boolean> {
  const rec: CheckRecord = { id, group, required, result: "FAIL", detail: "" };
  try {
    const o = await fn();
    if (o.skip) { rec.result = "SKIPPED"; rec.detail = short(o.skip, 240); }
    else { rec.result = o.ok ? "PASS" : "FAIL"; rec.detail = short(o.detail ?? "", 400); }
    if (o.status !== undefined) rec.status = o.status;
    if (o.observed) rec.observed = o.observed;
  } catch (e) {
    rec.result = "FAIL";
    rec.detail = `exception: ${short((e as Error)?.message ?? e, 300)}`;
  }
  evidence.checks.push(rec);
  log(`[${rec.result}] ${id}${rec.status !== undefined ? ` (${typeof rec.status === "object" ? JSON.stringify(rec.status) : rec.status})` : ""}${rec.result !== "PASS" ? ` - ${rec.detail}` : ""}`);
  persist();
  return rec.result === "PASS";
}
const skip = (reason: string): Out => ({ ok: false, skip: reason });

// ---------------------------------------------------------------------------------------------
// Rate budget (server: 100 /api requests / 15 min / IP, fixed window; we keep a conservative sliding window)
// ---------------------------------------------------------------------------------------------
class Budget {
  private stamps: number[] = [];
  waits = 0;
  waitedMs = 0;
  total = 0;
  private blockedUntil = 0;
  constructor(private limit: number) {}
  private purge() {
    const cut = Date.now() - (SERVER_WINDOW_MS + 10_000);
    while (this.stamps.length && this.stamps[0] < cut) this.stamps.shift();
  }
  free(): number { this.purge(); return this.limit - this.stamps.length; }
  /** Wait until n slots are free without consuming them (used before a browser page load). */
  async reserve(n: number, why: string) {
    for (;;) {
      this.purge();
      if (Date.now() >= this.blockedUntil && this.limit - this.stamps.length >= n) return;
      await this.pause(why);
    }
  }
  async take(why: string) {
    for (;;) {
      this.purge();
      if (Date.now() >= this.blockedUntil && this.stamps.length < this.limit) { this.stamps.push(Date.now()); this.total++; return; }
      await this.pause(why);
    }
  }
  /** After a real 429 the server window is full: block every request until it should reset. */
  exhaust(untilMs: number) { this.blockedUntil = Math.max(this.blockedUntil, untilMs); }
  private async pause(why: string) {
    const wait = Math.max(1000, Date.now() < this.blockedUntil ? this.blockedUntil - Date.now() : (this.stamps[0] ?? Date.now()) + SERVER_WINDOW_MS + 10_000 - Date.now());
    const step = Math.min(wait, 30_000);
    this.waits++;
    log(`rate budget full (${this.limit}/15min); waiting ${Math.round(wait / 1000)}s before: ${why}`);
    this.waitedMs += step;
    await sleep(step);
  }
}
const budget = new Budget(API_BUDGET);

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------
interface Sess {
  key: string;
  role: string;
  userId: string;
  name: string;
  email: string;
  token: string;
  refresh: string | null;
  expiresAt: number; // epoch seconds
  csrf: string | null;
  csrfAt: number;
}
interface Res {
  status: number;
  headers: Headers | null;
  json: any;
  text: string;
  error?: string;
}
interface Req {
  session?: Sess;
  json?: unknown;
  form?: FormData;
  bytes?: Uint8Array;
  contentType?: string;
  headers?: Record<string, string>;
  noBudget?: boolean;
  timeoutMs?: number;
}
/** Node 20 has no global WebSocket; newer supabase-js builds a realtime client eagerly, so hand it `ws` (never used here). */
const REALTIME = { transport: WebSocket as unknown as never };
const anonClient = (): SupabaseClient =>
  createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
    realtime: REALTIME,
  });

async function rawFetch(method: string, url: string, init: { headers?: Record<string, string>; body?: any; timeoutMs?: number } = {}): Promise<Res> {
  try {
    const r = await fetch(url, {
      method,
      headers: init.headers,
      body: init.body,
      redirect: "manual",
      signal: AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });
    const text = await r.text();
    let json: any = null;
    const ct = r.headers.get("content-type") ?? "";
    if (/json/i.test(ct) || /^\s*[{[]/.test(text)) { try { json = JSON.parse(text); } catch { /* not json */ } }
    return { status: r.status, headers: r.headers, json, text: text.slice(0, 6000) };
  } catch (e) {
    return { status: 0, headers: null, json: null, text: "", error: (e as Error)?.name === "TimeoutError" ? "timeout" : short((e as Error)?.message ?? e, 120) };
  }
}

async function refreshSession(s: Sess) {
  if (!s.refresh || s.expiresAt - Date.now() / 1000 > 600) return;
  try {
    const c = anonClient();
    const { data, error } = await c.auth.refreshSession({ refresh_token: s.refresh });
    if (!error && data.session) {
      s.token = data.session.access_token; s.refresh = data.session.refresh_token; s.expiresAt = data.session.expires_at ?? s.expiresAt;
      addSecret(s.token); addSecret(s.refresh);
      s.csrf = null;
    }
  } catch { /* keep the old token; the request will report the failure */ }
}

async function http(method: string, p: string, o: Req = {}): Promise<Res> {
  const isApi = p.startsWith("/api/");
  let last: Res = { status: 0, headers: null, json: null, text: "" };
  for (let attempt = 0; attempt < 3; attempt++) {
    if (o.session) await refreshSession(o.session);
    const headers: Record<string, string> = { accept: "application/json", origin: BASE, ...(o.headers ?? {}) };
    if (o.session) {
      headers.authorization = `Bearer ${o.session.token}`;
      if (method !== "GET" && isApi) {
        if (!o.session.csrf || Date.now() - o.session.csrfAt > 45 * 60_000) await fetchCsrf(o.session);
        if (o.session.csrf) headers["x-csrf-token"] = o.session.csrf;
      }
    }
    let body: any;
    if (o.json !== undefined) { headers["content-type"] = "application/json"; body = JSON.stringify(o.json); }
    else if (o.form) body = o.form;
    else if (o.bytes) { if (o.contentType) headers["content-type"] = o.contentType; body = o.bytes; }
    if (isApi && !o.noBudget) await budget.take(`${method} ${p.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id").split("?")[0]}`);
    last = await rawFetch(method, BASE + p, { headers, body, timeoutMs: o.timeoutMs });
    if (last.status === 429 && isApi) {
      const ra = Number(last.headers?.get("retry-after"));
      const wait = Math.min(960, Number.isFinite(ra) && ra > 0 ? ra + 2 : 120);
      log(`HTTP 429 from server; waiting ${wait}s`);
      budget.exhaust(Date.now() + wait * 1000);
      evidence.rateLimit.serverRejections = Number(evidence.rateLimit.serverRejections ?? 0) + 1;
      await sleep(wait * 1000);
      continue;
    }
    return last;
  }
  return last;
}
async function fetchCsrf(s: Sess): Promise<boolean> {
  if (s.expiresAt - Date.now() / 1000 < 600) await refreshSession(s);
  await budget.take("GET /api/csrf-token");
  const r = await rawFetch("GET", BASE + "/api/csrf-token", { headers: { authorization: `Bearer ${s.token}`, origin: BASE, accept: "application/json" } });
  if (r.status === 200 && typeof r.json?.csrfToken === "string") { s.csrf = r.json.csrfToken; s.csrfAt = Date.now(); addSecret(s.csrf); return true; }
  return false;
}
const get = (p: string, session?: Sess) => http("GET", p, { session });
const post = (p: string, json: unknown, session?: Sess, headers?: Record<string, string>) => http("POST", p, { session, json, headers });
const brief = (r: Res) => {
  const j = r.json;
  const code = j?.code ?? j?.error?.code ?? "";
  const msg = typeof j?.error === "string" ? j.error : j?.error?.message ?? j?.message ?? "";
  return short(`${r.status}${r.error ? ` ${r.error}` : ""} ${code} ${msg}`.trim(), 160);
};

/** PUT bytes to a Supabase signed-upload URL (raw body first, multipart like supabase-js as fallback). */
async function putSigned(url: string, bytes: Uint8Array, mime: string): Promise<number> {
  let r = await rawFetch("PUT", url, { headers: { "content-type": mime, "x-upsert": "false", "cache-control": "max-age=3600" }, body: bytes, timeoutMs: 30_000 });
  if (r.status >= 200 && r.status < 300) return r.status;
  if (r.status === 400 || r.status === 415 || r.status === 422) {
    const fd = new FormData();
    fd.append("cacheControl", "3600");
    fd.append("", new Blob([bytes as BlobPart], { type: mime }));
    const r2 = await rawFetch("PUT", url, { headers: { "x-upsert": "false" }, body: fd, timeoutMs: 30_000 });
    return r2.status;
  }
  return r.status;
}

// ---------------------------------------------------------------------------------------------
// Synthetic payloads (no dependencies)
// ---------------------------------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "ascii"), Buffer.from(data)]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** A real, decodable w x h RGB PNG (solid colour with a diagonal stripe). */
function makePng(w = 32, h = 32, rgb: [number, number, number] = [212, 175, 55]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    raw[row] = 0;
    for (let x = 0; x < w; x++) {
      const stripe = (x + y) % 8 === 0;
      raw[row + 1 + x * 3] = stripe ? 255 : rgb[0];
      raw[row + 2 + x * 3] = stripe ? 255 : rgb[1];
      raw[row + 3 + x * 3] = stripe ? 255 : rgb[2];
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr), pngChunk("IDAT", zlib.deflateSync(raw)), pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
// A real 16x16 baseline JPEG (632 bytes), embedded.
const JPEG_B64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAA0JCgsKCA0LCgsODg0PEyAVExISEyccHhcgLikxMC4pLSwzOko+MzZGNywtQFdBRkxOUlNSMj5aYVpQYEpRUk//2wBDAQ4ODhMREyYVFSZPNS01T09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT0//wAARCAAQABADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDbooor5k9A/9k=";
// The replacement image is the synthetic DEMO avatar, so the account ends in a presentable state.
const makeJpeg = () => {
  try { return fs.readFileSync("scripts/s26/assets/demo-avatar.jpg"); } catch { return Buffer.from(JPEG_B64, "base64"); }
};
/** A minimal valid one-page PDF with correct xref offsets. */
function makePdf(line: string): Buffer {
  const text = line.replace(/[^\x20-\x7E]/g, "?").replace(/[()\\]/g, "");
  const stream = `BT /F1 12 Tf 12 70 Td (${text}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 420 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(out.length); out += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, "0")} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const photoRef = (u: unknown): { kind: string; ext: string; id8: string } | null => {
  if (typeof u !== "string" || !u) return null;
  if (u.startsWith("data:")) return { kind: "data-url", ext: u.slice(5, u.indexOf(";")), id8: sha8(u) };
  const m = u.match(/profile-photos\/([A-Za-z0-9_-]+)\.(png|jpg|webp)/);
  if (!m) return { kind: "other", ext: "?", id8: sha8(u.split("?")[0]) };
  return { kind: "storage", ext: m[2], id8: sha8(m[1]) };
};
const looksLike = (bytes: Uint8Array, kind: "png" | "jpg" | "pdf") =>
  kind === "png" ? bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    : kind === "jpg" ? bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
      : bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
/** Download a signed object URL (never recorded) and report only whether the bytes look right. */
async function fetchBytesLike(url: unknown, kind: "png" | "jpg" | "pdf"): Promise<{ status: number; magic: boolean }> {
  if (typeof url !== "string" || !/^https:\/\//.test(url)) return { status: 0, magic: false };
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const b = new Uint8Array(await r.arrayBuffer());
    return { status: r.status, magic: r.ok && looksLike(b, kind) };
  } catch { return { status: 0, magic: false }; }
}

// ---------------------------------------------------------------------------------------------
// Shared context
// ---------------------------------------------------------------------------------------------
const ctx: {
  admin?: Sess; adminClient?: SupabaseClient; adminUserId?: string;
  student?: Sess; studentPassword?: string;
  sid?: string; sid2?: string; studentUserId?: string; realStudentId?: string;
  studentDocId?: string; staffDocId?: string;
  ticketId?: string;
  photo1?: { id8: string; ext: string }; photo2?: { id8: string; ext: string };
  photo1Url?: string;
} = {};

const flatCourses = (view: any): any[] => (view?.subjects ?? []).flatMap((s: any) => s.courses ?? []);

// ---------------------------------------------------------------------------------------------
// Main journey
// ---------------------------------------------------------------------------------------------
async function platformChecks() {
  await run("platform.health", "platform", true, async () => {
    const r = await rawFetch("GET", BASE + "/health");
    const rel = r.json?.release;
    const ok = r.status === 200 && typeof rel === "string" && rel.length >= 7;
    return { ok, status: r.status, detail: ok ? `release ${rel.slice(0, 12)}` : `release=${rel === undefined ? "absent" : rel === null ? "null (no release marker published)" : "invalid"}`, observed: { release: typeof rel === "string" ? rel.slice(0, 40) : rel ?? null, db: r.json?.checks?.database, memory: r.json?.checks?.memory } };
  });
  await run("platform.login-page", "platform", true, async () => {
    const r = await rawFetch("GET", BASE + "/login", { headers: { accept: "text/html" } });
    const ct = r.headers?.get("content-type") ?? "";
    const ok = r.status === 200 && /html/i.test(ct) && /<div id="root"|<html/i.test(r.text);
    return { ok, status: r.status, detail: `content-type ${short(ct, 40)}` };
  });
  await run("platform.ready", "platform", true, async () => {
    const r = await rawFetch("GET", BASE + "/ready");
    const checks: Record<string, unknown> = r.json?.checks ?? {};
    const failing = Object.entries(checks).filter(([, v]) => v !== true).map(([k]) => k);
    const tolerated = new Set(["distributedRateLimit", "authEmail", "customSmtpDeclared"]);
    const ok = r.status === 200 || (r.status === 503 && r.json?.ready === false && failing.length > 0 && failing.every((f) => tolerated.has(f)));
    return { ok, status: r.status, detail: r.status === 200 ? "ready" : `not ready; failing checks: ${failing.join(",") || "unknown (no checks in body)"}`, observed: { checks, mailMode: r.json?.mailMode ?? null, failing } };
  });
  await run("platform.api-404-json", "platform", true, async () => {
    const r = await get("/api/definitely-not-a-route");
    const ct = r.headers?.get("content-type") ?? "";
    const ok = r.status === 404 && /json/i.test(ct) && r.json?.code === "NOT_FOUND";
    return { ok, status: r.status, detail: `content-type ${short(ct, 40)} code ${short(r.json?.code, 30)}` };
  });
  await run("platform.students-me-unauthenticated", "platform", true, async () => {
    const r = await get("/api/students/me");
    return { ok: r.status === 401, status: r.status, detail: brief(r) };
  });
}

async function adminSession(): Promise<Out> {
  const url = process.env.SUPABASE_URL, svc = process.env.SUPABASE_SERVICE_KEY, anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !svc || !anon) return { ok: false, detail: "SUPABASE_URL / SUPABASE_SERVICE_KEY / SUPABASE_ANON_KEY missing" };
  const service = createClient(url, svc, { auth: { autoRefreshToken: false, persistSession: false }, realtime: REALTIME });
  const admins = await service.from("users").select("id,email,name,role,created_at").eq("role", "admin").order("created_at", { ascending: true }).limit(1);
  const owner = admins.data?.[0];
  if (admins.error || !owner) return { ok: false, detail: `no admin user found (${short(admins.error?.message ?? "empty")})` };
  addSecret(owner.email);
  const gen = await service.auth.admin.generateLink({ type: "magiclink", email: owner.email });
  const hashed = gen.data?.properties?.hashed_token;
  if (gen.error || !hashed) return { ok: false, detail: `generateLink failed (${short(gen.error?.message ?? "no hashed_token")})` };
  addSecret(hashed);
  const client = anonClient();
  const signed = await client.auth.verifyOtp({ token_hash: hashed, type: "magiclink" });
  if (signed.error || !signed.data.session || signed.data.user?.id !== owner.id) return { ok: false, detail: `verifyOtp failed (${short(signed.error?.message ?? "wrong user")})` };
  const s = signed.data.session;
  ctx.adminClient = client;
  ctx.adminUserId = owner.id;
  ctx.admin = { key: "admin", role: "admin", userId: owner.id, name: owner.name ?? "Admin", email: owner.email, token: s.access_token, refresh: s.refresh_token, expiresAt: s.expires_at ?? 0, csrf: null, csrfAt: 0 };
  addSecret(s.access_token); addSecret(s.refresh_token);
  const ok = await fetchCsrf(ctx.admin);
  return { ok, status: ok ? 200 : "csrf-failed", detail: ok ? "magic-link session exchanged without sending email; csrf token issued" : "csrf token not issued" };
}

async function adminChecks() {
  await run("admin.session-magic-link", "admin", true, adminSession);
  const A = ctx.admin;

  await run("admin.me-role-admin", "admin", true, async () => {
    if (!A) return skip("no admin session");
    const r = await get("/api/me", A);
    return { ok: r.status === 200 && r.json?.user?.role === "admin", status: r.status, detail: `role ${short(r.json?.user?.role, 20)}` };
  });

  // Discovery: the staff list (name search) -> demo student ids. Service-role lookup is only a fallback for the ids.
  await run("admin.staff-list-finds-demo-student", "admin", true, async () => {
    if (!A) return skip("no admin session");
    let r = await get("/api/students?search=DEMO&limit=50", A);
    let rows: any[] = Array.isArray(r.json?.students) ? r.json.students : [];
    let demo = rows.find((s) => s.preferred_name === DEMO_PREFERRED);
    let second = rows.find((s) => s.preferred_name === DEMO_SECOND_PREFERRED);
    let via = "search=DEMO";
    if (!demo && r.status === 200) {
      r = await get("/api/students?search=s26.demo&limit=50", A);
      rows = Array.isArray(r.json?.students) ? r.json.students : [];
      demo = rows.find((s) => s.preferred_name === DEMO_PREFERRED);
      second = rows.find((s) => s.preferred_name === DEMO_SECOND_PREFERRED);
      via = "search=s26.demo";
    }
    if (demo) ctx.sid = demo.id;
    if (second) ctx.sid2 = second.id;
    let fallback = "";
    if (!ctx.sid && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY) {
      const service = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false }, realtime: REALTIME });
      const q = await service.from("students").select("id,preferred_name,user_id").in("preferred_name", [DEMO_PREFERRED, DEMO_SECOND_PREFERRED]);
      for (const row of q.data ?? []) {
        if (row.preferred_name === DEMO_PREFERRED) ctx.sid = row.id;
        if (row.preferred_name === DEMO_SECOND_PREFERRED) ctx.sid2 = row.id;
      }
      fallback = " (ids recovered from the database because the staff list did not return them)";
    }
    evidence.ids.demoStudentId = ctx.sid ?? null;
    evidence.ids.secondDemoStudentId = ctx.sid2 ?? null;
    const ok = r.status === 200 && !!demo && !!second;
    return { ok, status: r.status, detail: `${via}: demo ${demo ? "found" : "NOT found"}, second ${second ? "found" : "NOT found"}, ${rows.length} rows${fallback}`, observed: { total: r.json?.total ?? null } };
  });

  await run("admin.staff-high-school-state", "admin", true, async () => {
    if (!A || !ctx.sid) return skip("no admin session or demo student id");
    const r = await get(`/api/admin/students/${ctx.sid}/high-school`, A);
    const cur = r.json?.current;
    const ok = r.status === 200 && cur?.credits?.requiredHalfUnits === 42 && cur?.credits?.earnedHalfUnits === 0 && !!cur?.published;
    return { ok, status: r.status, detail: ok ? "enrollment current, published roadmap, 42 required / 0 earned half-units" : brief(r), observed: { required: cur?.credits?.requiredHalfUnits, earned: cur?.credits?.earnedHalfUnits, awards: cur?.awards?.length, results: cur?.results?.length, published: !!cur?.published, reviewQueue: cur?.reviewQueue?.length } };
  });

  await run("admin.view-as-student-read-only-preview", "admin", true, async () => {
    if (!A || !ctx.sid) return skip("no admin session or demo student id");
    const r = await get(`/api/admin/students/${ctx.sid}/view-as-student`, A);
    const hs = r.json?.highSchool;
    const courses = flatCourses(hs);
    const testOnly = courses.filter((c) => /TEST ONLY/i.test(String(c.title))).length;
    const ok = r.status === 200 && r.json?.mode === "read_only_preview" && hs?.credits?.requiredHalfUnits === 42 && hs?.credits?.earnedHalfUnits === 0 && courses.length === 22 && testOnly === 5;
    return { ok, status: r.status, detail: ok ? "read_only_preview; 42 required / 0 earned; 22 courses; 5 TEST ONLY" : `mode=${short(r.json?.mode, 30)} req=${hs?.credits?.requiredHalfUnits} earned=${hs?.credits?.earnedHalfUnits} courses=${courses.length} testOnly=${testOnly}`, observed: { mode: r.json?.mode, courses: courses.length, subjects: (hs?.subjects ?? []).length, testOnlyTitles: testOnly, summary: r.json?.summary ?? null, hasPortalAccount: r.json?.student?.hasPortalAccount, preferredLanguage: r.json?.student?.preferredLanguage } };
  });

  if (SKIP_AI) {
    for (const id of ["admin.owner-ai-status", "admin.owner-ai-answer-en", "admin.owner-ai-draft-reply-fr"]) {
      await run(id, "admin", false, async () => skip("--skip-ai"));
    }
    return;
  }
  await run("admin.owner-ai-status", "admin", true, async () => {
    if (!A || !ctx.sid) return skip("no admin session or demo student id");
    const r = await get(`/api/admin/students/${ctx.sid}/owner-assistant/status`, A);
    const live = r.json?.mode === "live";
    const ok = r.status === 200 && (live || (ALLOW_AI_UNAVAILABLE && r.json?.mode === "unavailable"));
    return { ok, status: r.status, detail: `mode ${short(r.json?.mode, 20)}${r.json?.reason ? ` reason ${short(r.json?.reason, 30)}` : ""}${!live && !ALLOW_AI_UNAVAILABLE ? " — Spark must be live" : ""}`, observed: { mode: r.json?.mode, reason: r.json?.reason ?? null } };
  });
  const FRENCH = /\b(vous|votre|bonjour|feuille de route|cours|merci|élève|dossier|nous)\b/i;
  const answers: Record<string, any> = {};
  const ownerAsk = async (question: string, language: "en" | "fr", task: "answer" | "draft_reply"): Promise<Out> => {
    if (!A || !ctx.sid) return skip("no admin session or demo student id");
    // The server allows Spark up to 30 s (more with context loading); never cut a live answer off client-side.
    const r = await http("POST", `/api/admin/students/${ctx.sid}/owner-assistant`, { session: A, json: { question, language, task }, timeoutMs: OWNER_AI_TIMEOUT_MS });
    const j = r.json;
    answers[`${task}-${language}`] = j;
    const sourceRefs = new Set(Array.isArray(j?.sources) ? j.sources.map((x: { ref?: string }) => x?.ref) : []);
    const citations: Array<{ ref?: string }> = Array.isArray(j?.citations) ? j.citations : [];
    const reply = typeof j?.reply === "string" ? j.reply : "";
    const problems: string[] = [];
    if (r.status !== 200) problems.push(`HTTP ${r.status}${r.status === 0 ? ` (${short((r as { error?: string }).error ?? "no response", 80)} after ${OWNER_AI_TIMEOUT_MS / 1000}s client wait)` : ""}`);
    if (j?.mode !== "live" && !(ALLOW_AI_UNAVAILABLE && j?.mode === "unavailable")) problems.push(`mode ${short(j?.mode, 20)}${j?.reason ? ` (${short(j.reason, 30)})` : ""}: Spark did not answer`);
    if (j?.mode === "live") {
      if (reply.trim().length < 40) problems.push("reply empty or too short");
      if (citations.length < 1) problems.push("no [R#] record citations");
      if (citations.some((c) => !sourceRefs.has(c?.ref))) problems.push("a citation does not match a returned source record");
      // Model identity is judged separately (fields exist only on S27+ builds); a reported mismatch still fails here.
      if (j?.model && j.model.requested !== EXPECTED_MODEL) problems.push(`requested model ${short(j.model.requested ?? "missing", 60)}`);
      if (language === "fr" && !FRENCH.test(reply)) problems.push("draft is not in French");
    }
    if (j?.requiresHumanApproval !== true) problems.push("requiresHumanApproval missing");
    const ok = problems.length === 0;
    return { ok, status: r.status, detail: ok ? `mode ${j.mode}, model ${j?.model?.requested ?? "-"} (served: ${j?.model?.served ?? "not reported"}), ${citations.length} citations, reply ${reply.length} chars` : problems.join("; "), observed: { task, language, mode: j?.mode ?? null, reason: j?.reason ?? null, model: j?.model ?? null, citations: citations.length, citationRefs: citations.map((c) => c?.ref ?? null), sources: sourceRefs.size, replyLength: reply.length, replyStart: reply ? short(reply, 400) : null, recordSummaryLength: typeof j?.recordSummary === "string" ? j.recordSummary.length : null, requiresHumanApproval: j?.requiresHumanApproval ?? null } };
  };
  await run("admin.owner-ai-answer-en", "admin", true, () => ownerAsk("For this test student, which courses and documents still require action? Cite records.", "en", "answer"));
  await sleep(2500);
  await run("admin.owner-ai-draft-reply-fr", "admin", true, () => ownerAsk("Rédige un brouillon de réponse courtois pour cet élève test concernant l'avancement de sa feuille de route. Cite les dossiers.", "fr", "draft_reply"));
  const functionalIds = ["admin.owner-ai-status", "admin.owner-ai-answer-en", "admin.owner-ai-draft-reply-fr"];
  const functional = evidence.checks.filter((c) => functionalIds.includes(c.id));
  evidence.aiFunctional = functional.length === 3 && functional.every((c) => c.result === "PASS") ? "PASS" : "FAIL";
  // Model identity, reported separately. Builds without the model fields -> NOT VERIFIED (optional, never PASS);
  // builds with them -> required and strict.
  const live = Object.values(answers).filter((j) => j?.mode === "live");
  const reported = live.length > 0 && live.every((j) => j?.model && typeof j.model === "object");
  await run("admin.owner-ai-model-requested", "admin", reported, async () => {
    if (!reported) return skip(live.length ? "NOT VERIFIED: the deployed server does not report the requested model (added in S27); it is pinned server-side to " + EXPECTED_MODEL : "NOT VERIFIED: no live Spark answer to inspect");
    const req = live.map((j) => j.model.requested ?? null);
    const ok = req.every((m) => m === EXPECTED_MODEL);
    evidence.aiModelRequested = ok ? "PASS" : "FAIL";
    return { ok, detail: ok ? `requested ${EXPECTED_MODEL} for ${req.length} answers` : `requested ${req.join(", ")}`, observed: { requested: req } };
  });
  await run("admin.owner-ai-model-served", "admin", reported, async () => {
    if (!reported) return skip(live.length ? "NOT VERIFIED: the deployed server does not report the provider-served model (added in S27)" : "NOT VERIFIED: no live Spark answer to inspect");
    const served = live.map((j) => j.model.served ?? null);
    if (served.some((m) => m === null)) {
      evidence.aiModelVerification = "NOT_VERIFIED";
      return { ok: false, detail: "NOT VERIFIED: the provider response did not name a model", observed: { served } };
    }
    const ok = served.every((m) => m === EXPECTED_MODEL);
    evidence.aiModelVerification = ok ? "PASS" : "FAIL";
    return { ok, detail: ok ? `provider reported ${EXPECTED_MODEL} for ${served.length} answers` : `provider reported ${served.join(", ")}`, observed: { served } };
  });
}

function readPassword(): string | null {
  const env = process.env.S26_DEMO_STUDENT_PASSWORD?.trim();
  if (env) return env;
  try {
    const m = fs.readFileSync(CRED_FILE, "utf8").match(/^password:\s*(.+)$/m);
    return m ? m[1].trim() : null;
  } catch { return null; }
}

async function studentChecks() {
  await run("student.login-password", "student", true, async () => {
    const password = readPassword();
    if (!password) return { ok: false, detail: `no password: set S26_DEMO_STUDENT_PASSWORD or provide ${CRED_FILE}` };
    addSecret(password);
    ctx.studentPassword = password;
    addSecret(DEMO_STUDENT_EMAIL);
    const r = await http("POST", "/api/auth/login", { json: { email: DEMO_STUDENT_EMAIL, password } });
    const s = r.json?.session;
    if (r.status !== 200 || !s?.access_token) return { ok: false, status: r.status, detail: brief(r) };
    ctx.student = { key: "student", role: String(r.json.user?.role ?? ""), userId: String(r.json.user?.id ?? ""), name: String(r.json.user?.name ?? "DEMO"), email: DEMO_STUDENT_EMAIL, token: s.access_token, refresh: s.refresh_token ?? null, expiresAt: Number(s.expires_at ?? 0), csrf: null, csrfAt: 0 };
    addSecret(s.access_token); addSecret(s.refresh_token);
    ctx.studentUserId = ctx.student.userId;
    const ok = await fetchCsrf(ctx.student);
    return { ok: ok && ctx.student.role === "student", status: 200, detail: ok ? "password login ok; csrf token issued" : "login ok but csrf token not issued" };
  });
  const S = ctx.student;

  await run("student.me-role-student", "student", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/me", S);
    return { ok: r.status === 200 && r.json?.user?.role === "student", status: r.status, detail: `role ${short(r.json?.user?.role, 20)}` };
  });

  await run("student.profile-matches-demo-student", "student", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/students/me", S);
    if (r.status === 200 && typeof r.json?.id === "string") {
      if (ctx.sid && ctx.sid !== r.json.id) return { ok: false, status: r.status, detail: "student id differs from the staff-list demo id" };
      ctx.sid = ctx.sid ?? r.json.id;
      evidence.ids.demoStudentId = ctx.sid ?? null;
    }
    const ok = r.status === 200 && r.json?.preferred_name === DEMO_PREFERRED;
    return { ok, status: r.status, detail: ok ? "preferred_name marker DEMO-S26-FR" : brief(r), observed: { photoBefore: photoRef(r.json?.photo_url)?.kind ?? null } };
  });

  let hsView: any = null;
  await run("student.high-school-view", "student", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/student/high-school", S);
    hsView = r.json;
    const courses = flatCourses(hsView);
    const msg = String(hsView?.roadmap?.studentMessage ?? "");
    const ok = r.status === 200 && hsView?.credits?.requiredHalfUnits === 42 && hsView?.credits?.earnedHalfUnits === 0 && courses.length === 22 && msg.startsWith(DEMO_TAG_PREFIX);
    return { ok, status: r.status, detail: ok ? "42 required / 0 earned / 22 courses / DEMO roadmap message" : `req=${hsView?.credits?.requiredHalfUnits} earned=${hsView?.credits?.earnedHalfUnits} courses=${courses.length} messageStartsDemo=${msg.startsWith(DEMO_TAG_PREFIX)}`, observed: { required: hsView?.credits?.requiredHalfUnits, earned: hsView?.credits?.earnedHalfUnits, courses: courses.length, subjects: (hsView?.subjects ?? []).length, awaitingConfirmationHalfUnits: hsView?.credits?.awaitingConfirmationHalfUnits, pace: hsView?.pace?.status } };
  });

  await run("student.progress-report-in-progress", "student", true, async () => {
    if (!S || !hsView) return skip("no student session or high-school view");
    const course = flatCourses(hsView).find((c) => c.key === "startup-personal-growth");
    const task = course?.tasks?.[0];
    if (!course || !task) return { ok: false, detail: "course startup-personal-growth or its first task not found" };
    const body = (rev: number) => ({ courseKey: course.key, taskKey: task.key, status: "in_progress", expectedRevision: rev, note: "DEMO — acceptance check (synthetic)" });
    let r = await post("/api/student/high-school/progress", body(task.progressRevision ?? 0), S);
    if (r.status === 409) {
      const fresh = await get("/api/student/high-school", S);
      const t2 = flatCourses(fresh.json).find((c) => c.key === course.key)?.tasks?.[0];
      r = await post("/api/student/high-school/progress", body(t2?.progressRevision ?? 0), S);
    }
    if (r.status !== 200) return { ok: false, status: r.status, detail: brief(r) };
    const again = await get("/api/student/high-school", S);
    const t3 = flatCourses(again.json).find((c) => c.key === course.key)?.tasks?.find((t: any) => t.key === task.key);
    const ok = again.status === 200 && t3?.status === "in_progress" && again.json?.credits?.earnedHalfUnits === 0;
    return { ok, status: { post: r.status, reget: again.status }, detail: ok ? `task ${task.key} now in_progress; earned half-units still 0` : `task status ${t3?.status}; earned ${again.json?.credits?.earnedHalfUnits}`, observed: { taskKey: task.key, statusAfter: t3?.status, earnedHalfUnits: again.json?.credits?.earnedHalfUnits, revisionBefore: task.progressRevision, revisionAfter: t3?.progressRevision } };
  });
}

async function photoChecks() {
  const S = ctx.student, A = ctx.admin;
  const upload = async (bytes: Uint8Array, mime: string, name: string) => {
    const fd = new FormData();
    fd.append("photo", new Blob([bytes as BlobPart], { type: mime }), name);
    return http("POST", `/api/students/${ctx.sid}/photo`, { session: S, form: fd, timeoutMs: 45_000 });
  };
  await run("photo.upload-png", "photo", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const r = await upload(makePng(), "image/png", "demo-avatar.png");
    const ref = photoRef(r.json?.photoUrl);
    return { ok: r.status === 200 && !!ref && (ref.ext === "png" || ref.kind === "data-url"), status: r.status, detail: r.status === 200 ? `stored as ${ref?.kind}/${ref?.ext}` : brief(r), observed: { ext: ref?.ext } };
  });
  await run("photo.reload-shows-png", "photo", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/students/me", S);
    const ref = photoRef(r.json?.photo_url);
    if (ref) ctx.photo1 = { id8: ref.id8, ext: ref.ext };
    ctx.photo1Url = typeof r.json?.photo_url === "string" ? r.json.photo_url : undefined;
    const bytes = await fetchBytesLike(r.json?.photo_url, "png");
    return { ok: r.status === 200 && !!ref && (ref.ext === "png" || ref.kind === "data-url") && (bytes.magic || ref.kind === "data-url"), status: { profile: r.status, signedImage: bytes.status }, detail: `reference ${ref ? `${ref.kind}/${ref.ext}` : "none"}; signed image bytes look like PNG: ${bytes.magic}` };
  });
  await run("photo.replace-with-jpeg", "photo", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const r = await upload(makeJpeg(), "image/jpeg", "demo-avatar.jpg");
    const ref = photoRef(r.json?.photoUrl);
    return { ok: r.status === 200 && !!ref && (ref.ext === "jpg" || ref.ext === "image/jpeg"), status: r.status, detail: r.status === 200 ? `stored as ${ref?.kind}/${ref?.ext}` : brief(r) };
  });
  await run("photo.reload-shows-jpeg-and-changed", "photo", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/students/me", S);
    const ref = photoRef(r.json?.photo_url);
    if (ref) ctx.photo2 = { id8: ref.id8, ext: ref.ext };
    const bytes = await fetchBytesLike(r.json?.photo_url, "jpg");
    const changed = !!ref && !!ctx.photo1 && ref.id8 !== ctx.photo1.id8;
    let oldGone: number | string = "n/a";
    if (ctx.photo1Url && /^https:/.test(ctx.photo1Url)) oldGone = (await fetchBytesLike(ctx.photo1Url, "png")).magic ? "old object still readable" : "old object no longer readable";
    return { ok: r.status === 200 && changed && (bytes.magic || ref?.kind === "data-url"), status: { profile: r.status, signedImage: bytes.status }, detail: `reference changed: ${changed}; new image bytes look like JPEG: ${bytes.magic}; previous object: ${oldGone}`, observed: { previousObject: oldGone } };
  });
  await run("photo.negative-svg-declared-png", "photo", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><script>alert(1)</script><rect width="8" height="8"/></svg>');
    const r = await upload(svg, "image/png", "demo-evil.png");
    return { ok: r.status >= 400 && r.status < 500, status: r.status, detail: brief(r) };
  });
  await run("photo.negative-html-declared-jpeg", "photo", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const html = Buffer.from("<!doctype html><html><body><script>alert(1)</script>DEMO</body></html>");
    const r = await upload(html, "image/jpeg", "demo-evil.jpg");
    return { ok: r.status >= 400 && r.status < 500, status: r.status, detail: brief(r) };
  });
  await run("photo.negative-over-5mib", "photo", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const big = Buffer.alloc(5 * 1024 * 1024 + 4096);
    makePng().copy(big, 0, 0, 8); // valid PNG magic, so only the size can reject it
    const r = await upload(big, "image/png", "demo-too-big.png");
    return { ok: r.status === 413 || r.status === 400, status: r.status, detail: brief(r) };
  });
  await run("photo.admin-sees-student-photo", "photo", true, async () => {
    if (!A || !ctx.sid) return skip("no admin session / student id");
    const r = await get(`/api/students/${ctx.sid}`, A);
    const ref = photoRef(r.json?.photo_url);
    const bytes = await fetchBytesLike(r.json?.photo_url, "jpg");
    const same = !!ref && !!ctx.photo2 && ref.id8 === ctx.photo2.id8;
    return { ok: r.status === 200 && same && (bytes.magic || ref?.kind === "data-url"), status: { admin: r.status, signedImage: bytes.status }, detail: `admin sees the same JPEG reference as the student (rejected uploads changed nothing): ${same}` };
  });
}

async function documentChecks() {
  const S = ctx.student, A = ctx.admin;
  const studentPdf = makePdf("DEMO - synthetic hs_transcript, not a real document");
  const staffPdf = makePdf("DEMO - synthetic staff upload, not a real document");
  const uploadFlow = async (who: Sess, docType: string, fileName: string, bytes: Buffer, notes: string): Promise<{ id?: string; steps: Record<string, number | string> }> => {
    const steps: Record<string, number | string> = {};
    const u = await post(`/api/documents/student/${ctx.sid}/upload-url`, { doc_type: docType, file_name: fileName, file_size: bytes.length, mime_type: "application/pdf" }, who);
    steps.uploadUrl = u.status;
    if (u.status !== 200 || !u.json?.upload_url || !u.json?.storage_path) return { steps };
    steps.put = await putSigned(u.json.upload_url, bytes, "application/pdf");
    if (steps.put !== 200 && steps.put !== 201) return { steps };
    const rec = await post(`/api/documents/student/${ctx.sid}`, { doc_type: docType, file_name: fileName, storage_path: u.json.storage_path, notes }, who);
    steps.record = rec.status;
    return { id: rec.status === 201 ? rec.json?.id : undefined, steps };
  };
  await run("documents.student-uploads-hs-transcript", "documents", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const f = await uploadFlow(S, "hs_transcript", "DEMO-student-hs-transcript.pdf", studentPdf, "DEMO — synthetic test document, not a real transcript");
    ctx.studentDocId = f.id;
    return { ok: !!f.id, status: f.steps, detail: f.id ? "upload-url, signed PUT and record all succeeded; status pending" : "flow stopped before a record was created" };
  });
  await run("documents.admin-uploads-on-behalf", "documents", true, async () => {
    if (!A || !ctx.sid) return skip("no admin session / student id");
    const f = await uploadFlow(A, "other", "DEMO-staff-uploaded-document.pdf", staffPdf, "DEMO — synthetic document uploaded by staff on behalf of the student");
    ctx.staffDocId = f.id;
    return { ok: !!f.id, status: f.steps, detail: f.id ? "staff upload on behalf recorded" : "flow stopped before a record was created" };
  });
  await run("documents.admin-verifies-student-document", "documents", true, async () => {
    if (!A || !ctx.studentDocId) return skip("no admin session / student document");
    const r = await post(`/api/documents/${ctx.studentDocId}/verify`, { admin_notes: "DEMO — illustrative verification (synthetic)" }, A);
    return { ok: r.status === 200 && r.json?.status === "verified", status: r.status, detail: r.status === 200 ? `status ${short(r.json?.status, 20)}` : brief(r) };
  });
  const REASON = "DEMO — illustrative rejection";
  await run("documents.admin-rejects-staff-document", "documents", true, async () => {
    if (!A || !ctx.staffDocId) return skip("no admin session / staff document");
    const r = await post(`/api/documents/${ctx.staffDocId}/reject`, { student_message: REASON, admin_notes: "DEMO internal note — not for the student" }, A);
    return { ok: r.status === 200 && r.json?.status === "rejected", status: r.status, detail: r.status === 200 ? `status ${short(r.json?.status, 20)}` : brief(r) };
  });
  await run("documents.student-lists-statuses-and-reason", "documents", true, async () => {
    if (!S || !ctx.sid || !ctx.studentDocId || !ctx.staffDocId) return skip("documents not created");
    const r = await get(`/api/documents/student/${ctx.sid}`, S);
    const rows: any[] = Array.isArray(r.json) ? r.json : [];
    const mine = rows.find((d) => d.id === ctx.studentDocId);
    const staff = rows.find((d) => d.id === ctx.staffDocId);
    const leaks = rows.some((d) => "admin_notes" in d || "storage_path" in d || "url" in d || "ocr_text" in d);
    const ok = r.status === 200 && mine?.status === "verified" && staff?.status === "rejected" && staff?.review_message === REASON && !leaks;
    return { ok, status: r.status, detail: `student doc ${mine?.status}; staff doc ${staff?.status}; reason visible: ${staff?.review_message === REASON}; staff-only fields leaked: ${leaks}`, observed: { count: rows.length, studentDocStatus: mine?.status, staffDocStatus: staff?.status, reasonVisible: staff?.review_message === REASON, leaked: leaks } };
  });
  await run("documents.student-downloads-own-document", "documents", true, async () => {
    if (!S || !ctx.studentDocId) return skip("no student document");
    const r = await get(`/api/documents/${ctx.studentDocId}`, S);
    const bytes = await fetchBytesLike(r.json?.download_url, "pdf");
    return { ok: r.status === 200 && typeof r.json?.download_url === "string" && bytes.magic, status: { api: r.status, signedFile: bytes.status }, detail: `download URL issued (not recorded); file bytes look like PDF: ${bytes.magic}` };
  });
  await run("documents.student-cannot-list-other-student", "documents", true, async () => {
    if (!S || !ctx.sid2) return skip("no student session / second demo student id");
    const r = await get(`/api/documents/student/${ctx.sid2}`, S);
    return { ok: r.status === 403 || r.status === 404, status: r.status, detail: brief(r) };
  });
}

async function supportChecks() {
  const S = ctx.student, A = ctx.admin;
  const marker = `DEMO-INTERNAL-ONLY-${crypto.randomBytes(5).toString("hex")}`;
  let publicCommentId: string | undefined;
  await run("support.student-creates-ticket", "support", true, async () => {
    if (!S) return skip("no student session");
    const key = crypto.randomBytes(12).toString("base64url");
    const r = await post("/api/tickets", { subject: "DEMO — question about my roadmap", description: "DEMO — synthetic acceptance-test ticket created by the S26 hosted acceptance script. No action is needed.", topic: "roadmap_question", idempotencyKey: key }, S);
    ctx.ticketId = r.json?.ticket?.id;
    evidence.ids.demoTicketId = ctx.ticketId ?? null;
    return { ok: r.status === 201 && !!ctx.ticketId, status: r.status, detail: r.status === 201 ? `ticket ${short(r.json?.ticket?.ticket_number, 30)} status ${short(r.json?.ticket?.status, 20)}` : brief(r) };
  });
  await run("support.admin-public-reply", "support", true, async () => {
    if (!A || !ctx.ticketId) return skip("no admin session / ticket");
    const r = await post(`/api/tickets/${ctx.ticketId}/comments`, { content: "DEMO — public reply from the Lumière team (synthetic acceptance test). Nothing to do on your side.", isInternal: false }, A);
    publicCommentId = r.json?.comment?.id;
    return { ok: r.status === 201 && !!publicCommentId && r.json?.comment?.is_internal === false, status: r.status, detail: r.status === 201 ? `ticket status now ${short(r.json?.ticket?.status, 20)}` : brief(r) };
  });
  await run("support.admin-internal-note", "support", true, async () => {
    if (!A || !ctx.ticketId) return skip("no admin session / ticket");
    const r = await post(`/api/tickets/${ctx.ticketId}/comments`, { content: `${marker} staff-only note, must never reach the student`, isInternal: true }, A);
    return { ok: r.status === 201 && r.json?.comment?.is_internal === true, status: r.status, detail: r.status === 201 ? "internal note stored" : brief(r) };
  });
  await run("support.admin-attaches-file", "support", true, async () => {
    if (!A || !ctx.ticketId) return skip("no admin session / ticket");
    const bytes = makePdf("DEMO - synthetic ticket attachment");
    const fileName = "DEMO-staff-attachment.pdf";
    const u = await post(`/api/tickets/${ctx.ticketId}/attachments/upload-url`, { file_name: fileName, file_size: bytes.length, file_type: "application/pdf" }, A);
    const steps: Record<string, number | string> = { uploadUrl: u.status };
    if (u.status !== 200 || !u.json?.uploadUrl || !u.json?.storagePath) return { ok: false, status: steps, detail: brief(u) };
    steps.put = await putSigned(u.json.uploadUrl, bytes, "application/pdf");
    if (steps.put !== 200 && steps.put !== 201) return { ok: false, status: steps, detail: "signed PUT failed" };
    const reg = await post(`/api/tickets/${ctx.ticketId}/attachments`, { file_name: fileName, file_size: bytes.length, file_type: "application/pdf", storage_path: u.json.storagePath, comment_id: publicCommentId ?? null }, A);
    steps.register = reg.status;
    return { ok: reg.status === 201 && !!reg.json?.attachment?.id, status: steps, detail: reg.status === 201 ? "attachment registered on the public reply" : brief(reg) };
  });
  // One student read covers both: public reply visible, internal note invisible, attachment metadata visible.
  let studentTicket: any = null;
  let studentTicketRes: Res | null = null;
  const loadStudentTicket = async () => {
    if (studentTicketRes || !S || !ctx.ticketId) return;
    studentTicketRes = await get(`/api/tickets/${ctx.ticketId}`, S);
    studentTicket = studentTicketRes.json?.ticket ?? null;
  };
  await run("support.student-sees-public-reply-not-internal-note", "support", true, async () => {
    if (!S || !ctx.ticketId) return skip("no student session / ticket");
    await loadStudentTicket();
    const t = studentTicket;
    const comments: any[] = t?.ticket_comments ?? [];
    const publicSeen = comments.some((c) => c.author_kind === "staff" && /public reply/i.test(String(c.content)));
    const internalLeak = JSON.stringify(studentTicketRes?.json ?? {}).includes(marker) || comments.some((c) => c.is_internal);
    return { ok: studentTicketRes!.status === 200 && publicSeen && !internalLeak, status: studentTicketRes!.status, detail: `public staff reply visible: ${publicSeen}; internal note leaked: ${internalLeak}`, observed: { comments: comments.length, status: t?.status } };
  });
  await run("support.student-sees-attachment-metadata", "support", true, async () => {
    if (!S || !ctx.ticketId) return skip("no student session / ticket");
    await loadStudentTicket();
    const atts: any[] = studentTicket?.ticket_attachments ?? [];
    const a = atts.find((x) => x.file_name === "DEMO-staff-attachment.pdf");
    const leak = atts.some((x) => "storage_path" in x);
    return { ok: !!a && a.file_type === "application/pdf" && !leak, status: studentTicketRes?.status, detail: `attachment metadata visible: ${!!a}; storage_path leaked: ${leak}`, observed: { attachments: atts.length, fileSize: a?.file_size ?? null } };
  });
  await run("support.admin-sees-internal-note", "support", true, async () => {
    if (!A || !ctx.ticketId) return skip("no admin session / ticket");
    const r = await get(`/api/tickets/${ctx.ticketId}`, A);
    const comments: any[] = r.json?.ticket?.ticket_comments ?? [];
    const note = comments.find((c) => c.is_internal === true && String(c.content).includes(marker));
    return { ok: r.status === 200 && !!note, status: r.status, detail: `internal note visible to staff: ${!!note}; ${comments.length} comments` };
  });
  await run("support.admin-patch-status-waiting-on-student", "support", true, async () => {
    if (!A || !ctx.ticketId) return skip("no admin session / ticket");
    const r = await http("PATCH", `/api/tickets/${ctx.ticketId}`, { session: A, json: { status: "waiting_on_student" } });
    return { ok: r.status === 200 && r.json?.ticket?.status === "waiting_on_student", status: r.status, detail: r.status === 200 ? `status ${short(r.json?.ticket?.status, 30)}` : brief(r) };
  });
}

async function assistantChecks() {
  const S = ctx.student;
  if (SKIP_AI) {
    for (const id of ["assistant.student-status", "assistant.student-message-fr"]) await run(id, "assistant", false, async () => skip("--skip-ai"));
    return;
  }
  await run("assistant.student-status", "assistant", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/assistant/status", S);
    return { ok: r.status === 200 && (r.json?.mode === "live" || r.json?.mode === "local"), status: r.status, detail: `mode ${short(r.json?.mode, 10)} reason ${short(r.json?.reason, 30)}`, observed: { enabled: r.json?.enabled, mode: r.json?.mode, reason: r.json?.reason ?? null, liveModel: r.json?.liveModel, suggestions: Array.isArray(r.json?.suggestions) ? r.json.suggestions.length : null } };
  });
  await run("assistant.student-message-fr", "assistant", true, async () => {
    if (!S) return skip("no student session");
    const r = await post("/api/assistant/message", { message: "Comment puis-je mieux organiser mes révisions en anglais ?", language: "fr" }, S);
    const j = r.json;
    return { ok: r.status === 200 && (j?.mode === "live" || j?.mode === "local") && typeof j?.reply === "string" && j.reply.length > 0, status: r.status, detail: r.status === 200 ? `mode ${j.mode}; reply ${String(j.reply).length} chars; notice: ${short(j.notice, 120) || "none"}` : brief(r), observed: { mode: j?.mode ?? null, notice: j?.notice ? short(j.notice, 240) : null, replyLength: typeof j?.reply === "string" ? j.reply.length : 0, sources: Array.isArray(j?.sources) ? j.sources.length : null, links: Array.isArray(j?.links) ? j.links.length : null } };
  });
}

/** S26: billing journey on the SYNTHETIC student only (records provisioned by the release; no real money). */
async function billingChecks() {
  const A = ctx.admin, S = ctx.student, id = ctx.sid;
  // The real pre-enrollment record (draft only): read-only checks, never written by this script.
  await run("real-student.draft-plan", "real-student", true, async () => {
    if (!A) return skip("no admin session");
    const list = await get(`/api/students?search=LCA-2026-0001&limit=5`, A);
    const real = (list.json?.students ?? []).find((x: any) => x.student_code === "LCA-2026-0001");
    if (!real) return { ok: false, status: list.status, detail: "LCA-2026-0001 not found" };
    ctx.realStudentId = real.id;
    const hs = await get(`/api/admin/students/${real.id}/high-school`, A);
    const cur = hs.json?.current;
    const courses = cur?.draft?.content?.courses ?? [];
    const electives = courses.filter((c: any) => c.areaKey === "electives").map((c: any) => String(c.title).split(" — ")[0]);
    const ok = hs.status === 200 && cur?.enrollment?.status === "planned" && !cur?.published && courses.length === 22
      && courses.reduce((n: number, c: any) => n + c.halfUnits, 0) === 42 && (cur?.credits?.earnedHalfUnits ?? -1) === 0
      && electives.join("|") === "Microsoft Word & Excel|Business Math|English Communications|Human Relations|Reading Skills";
    return { ok, status: hs.status, detail: `enrollment ${cur?.enrollment?.status}; published ${!!cur?.published}; draft courses ${courses.length}; electives ${electives.join(", ")}; official ${cur?.credits?.earnedHalfUnits}` ,
      observed: { studentStatus: real.status, portalLinked: !!real.user_id, hasPhoto: !!real.photo_url } };
  });
  await run("billing.admin-ledger", "billing", true, async () => {
    if (!A || !id) return skip("no admin session or demo id");
    const r = await get(`/api/admin/students/${id}/billing`, A);
    const b = r.json?.student;
    return { ok: r.status === 200 && b?.state === "configured" && b.netObligationCents === b.agreedCents - b.discountCents && b.remainingCents === Math.max(0, b.netObligationCents - b.paidCents),
      status: r.status, detail: r.status === 200 ? `state ${b?.state}; agreed ${b?.agreedCents}; adjustment ${b?.discountCents}; paid ${b?.paidCents}; remaining ${b?.remainingCents}` : brief(r),
      observed: { state: b?.state, receipts: r.json?.receipts?.length ?? null, installments: b?.installments?.length ?? null } };
  });
  await run("billing.student-summary", "billing", true, async () => {
    if (!S) return skip("no student session");
    const r = await get("/api/student/billing", S);
    const b = r.json;
    const leaked = JSON.stringify(b ?? {}).match(/"note"|internal/i);
    return { ok: r.status === 200 && b?.state === "configured" && typeof b?.remainingCents === "number" && !leaked, status: r.status,
      detail: r.status === 200 ? `student sees remaining ${b?.remainingCents}, paid ${b?.paidCents}; staff notes leaked: ${!!leaked}` : brief(r) };
  });
  await run("billing.student-denied-staff-ledger", "billing", true, async () => {
    if (!S || !id) return skip("no student session");
    const r = await get(`/api/admin/students/${id}/billing`, S);
    return { ok: r.status === 403, status: r.status, detail: brief(r) };
  });
}

async function authorizationChecks() {
  const S = ctx.student;
  await run("authz.student-denied-view-as-student", "authorization", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const r = await get(`/api/admin/students/${ctx.sid}/view-as-student`, S);
    return { ok: r.status === 403, status: r.status, detail: brief(r) };
  });
  await run("authz.student-denied-owner-assistant", "authorization", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const r = await post(`/api/admin/students/${ctx.sid}/owner-assistant`, { question: "DEMO authorization probe — must be refused", language: "en", task: "answer" }, S);
    return { ok: r.status === 403, status: r.status, detail: brief(r) };
  });
  await run("authz.student-denied-staff-high-school", "authorization", true, async () => {
    if (!S || !ctx.sid) return skip("no student session / student id");
    const r = await get(`/api/admin/students/${ctx.sid}/high-school`, S);
    return { ok: r.status === 403, status: r.status, detail: brief(r) };
  });
}

// ---------------------------------------------------------------------------------------------
// Browser (best effort, optional): Chromium over CDP
// ---------------------------------------------------------------------------------------------
function findChromium(): { exe: string | null; how: string } {
  const env = process.env.S26_CHROME || process.env.CHROME_BIN;
  if (env && fs.existsSync(env)) return { exe: env, how: "env" };
  for (const name of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) {
    const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
    const p = r.stdout?.trim();
    if (r.status === 0 && p) return { exe: p, how: `PATH:${name}` };
  }
  const roots = ["/opt/pw-browsers", path.resolve(".s26-tools/browsers"), process.env.PLAYWRIGHT_BROWSERS_PATH ?? ""].filter(Boolean);
  for (const root of roots) {
    try {
      if (fs.existsSync(path.join(root, "chromium")) && fs.statSync(path.join(root, "chromium")).isFile()) return { exe: path.join(root, "chromium"), how: `${root}/chromium` };
      for (const d of fs.readdirSync(root).filter((n) => /^chromium(_headless_shell)?-\d+/.test(n)).sort().reverse()) {
        for (const rel of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-linux/headless_shell", "chrome-headless-shell-linux64/chrome-headless-shell"]) {
          const p = path.join(root, d, rel);
          if (fs.existsSync(p)) return { exe: p, how: p.replace(os.homedir(), "~") };
        }
      }
    } catch { /* keep looking */ }
  }
  return { exe: null, how: "not found" };
}
function ensureChromium(): { exe: string | null; how: string } {
  let found = findChromium();
  if (found.exe) return found;
  log("no Chromium found; trying: npx -y playwright@1.49.1 install chromium (browsers under .s26-tools/browsers)");
  fs.mkdirSync(".s26-tools/browsers", { recursive: true });
  const r = spawnSync("npx", ["-y", "playwright@1.49.1", "install", "chromium"], { env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: path.resolve(".s26-tools/browsers") }, encoding: "utf8", timeout: 300_000 });
  if (r.status !== 0) log(`playwright install failed (status ${r.status})`);
  found = findChromium();
  return found.exe ? { exe: found.exe, how: `playwright-install:${found.how}` } : found;
}

const MASK_JS = `(()=>{const t=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i,g=/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/gi;const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);let n;while((n=w.nextNode())){const p=n.parentElement;if(p&&(p.tagName==='SCRIPT'||p.tagName==='STYLE'))continue;if(t.test(n.textContent))n.textContent=n.textContent.replace(g,'[email]')}document.querySelectorAll('input,textarea').forEach(i=>{if(t.test(i.value||''))i.value='[email]'});return true})()`;

class Page {
  private seq = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();
  private inflight = new Set<string>();
  blocked: string[] = [];
  allowedWrites: string[] = [];
  apiRequests = 0;
  socket!: WebSocket;
  constructor(private wsUrl: string, private blockWrites: boolean) {}
  async open() {
    this.socket = new WebSocket(this.wsUrl);
    await new Promise<void>((resolve, reject) => { this.socket.once("open", () => resolve()); this.socket.once("error", reject); });
    this.socket.on("message", (raw) => this.onMessage(JSON.parse(raw.toString())));
    await this.cmd("Page.enable"); await this.cmd("Runtime.enable"); await this.cmd("Network.enable");
    await this.cmd("Fetch.enable", { patterns: [{ urlPattern: "*://*/api/*", requestStage: "Request" }] });
  }
  cmd(method: string, params: Record<string, unknown> = {}, timeoutMs = 20_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const id = ++this.seq;
      this.pending.set(id, { resolve, reject });
      try { this.socket.send(JSON.stringify({ id, method, params })); } catch (e) { this.pending.delete(id); return reject(e as Error); }
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`CDP timeout ${method}`)); } }, timeoutMs).unref();
    });
  }
  private onMessage(m: any) {
    if (m.id && this.pending.has(m.id)) {
      const p = this.pending.get(m.id)!; this.pending.delete(m.id);
      m.error ? p.reject(new Error(`CDP ${short(m.error.message, 80)}`)) : p.resolve(m.result);
    } else if (m.method === "Fetch.requestPaused") {
      void this.onPaused(m.params);
    } else if (m.method === "Network.requestWillBeSent") {
      try { const u = new URL(m.params.request.url); if (u.origin === new URL(BASE).origin && u.pathname.startsWith("/api/")) this.inflight.add(m.params.requestId); } catch { /* ignore */ }
    } else if (m.method === "Network.loadingFinished" || m.method === "Network.loadingFailed") {
      this.inflight.delete(m.params.requestId);
    }
  }
  private async onPaused(p: any) {
    const req = p.request;
    let allowed = false, norm = "";
    try {
      const u = new URL(req.url);
      norm = `${req.method} ${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, ":id")}`;
      const sameOrigin = u.origin === new URL(BASE).origin;
      const read = req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS";
      allowed = sameOrigin && (read || !this.blockWrites || (req.method === "POST" && u.pathname === "/api/auth/refresh"));
      if (allowed && !read && !(req.method === "POST" && u.pathname === "/api/auth/refresh")) this.allowedWrites.push(norm);
    } catch { allowed = false; }
    if (!allowed) { if (this.blocked.length < 200) this.blocked.push(norm || "unparseable"); this.cmd("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).catch(() => {}); return; }
    this.apiRequests++;
    await budget.take(`browser ${norm}`);
    this.cmd("Fetch.continueRequest", { requestId: p.requestId }).catch(() => {});
  }
  async eval(expression: string): Promise<any> {
    const r = await this.cmd("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error("page evaluation failed");
    return r.result?.value;
  }
  async poll(expression: string, ms = 20_000): Promise<boolean> {
    const end = Date.now() + ms;
    while (Date.now() < end) { try { if (await this.eval(expression)) return true; } catch { /* page navigating */ } await sleep(250); }
    return false;
  }
  /** No /api request in flight for 800 ms and no spinner. */
  async settle(maxMs = 30_000) {
    const end = Date.now() + maxMs; let quietSince = 0;
    while (Date.now() < end) {
      let busy = this.inflight.size > 0;
      if (!busy) { try { busy = !!(await this.eval(`!!document.querySelector('.animate-spin,[aria-busy="true"],[data-testid*="skeleton"]')`)); } catch { busy = true; } }
      if (busy) quietSince = 0; else { quietSince ||= Date.now(); if (Date.now() - quietSince > 800) return true; }
      await sleep(200);
    }
    return false;
  }
  async click(finder: string): Promise<boolean> {
    const rect = await this.eval(`(()=>{const e=(${finder});if(!e)return null;e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2,w:r.width,h:r.height}})()`);
    if (!rect || !rect.w) return false;
    await this.cmd("Input.dispatchMouseEvent", { type: "mouseMoved", x: rect.x, y: rect.y });
    await this.cmd("Input.dispatchMouseEvent", { type: "mousePressed", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    await this.cmd("Input.dispatchMouseEvent", { type: "mouseReleased", x: rect.x, y: rect.y, button: "left", clickCount: 1 });
    return true;
  }
  close() { try { this.socket?.close(); } catch { /* ignore */ } for (const p of this.pending.values()) p.reject(new Error("closed")); this.pending.clear(); }
}

interface Shot { name: string; viewport: string; bytes: number; chunks: number }
const shots: Shot[] = [];
function saveShot(name: string, viewport: string, b64: string) {
  const dir = path.join(OUT, "shots"), bdir = path.join(OUT, "shots-b64");
  fs.mkdirSync(dir, { recursive: true }); fs.mkdirSync(bdir, { recursive: true });
  const file = `${name}-${viewport}`;
  fs.writeFileSync(path.join(dir, `${file}.jpg`), Buffer.from(b64, "base64"), { mode: 0o600 });
  // One base64 file per image, padded with trailing whitespace to >= 80,000 characters so a remote
  // file reader always hands it over as a file (decoders ignore whitespace).
  const padded = b64.length >= 80_000 ? b64 : b64 + "\n".repeat(80_000 - b64.length);
  fs.writeFileSync(path.join(bdir, `${file}.b64.txt`), padded, { mode: 0o600 });
  shots.push({ name: file, viewport, bytes: Math.round((b64.length * 3) / 4), chunks: 1 });
  evidence.browser.shots = shots;
}

async function launchBrowser(exe: string, port: number, profileDir: string, blockWrites: boolean): Promise<{ page: Page; proc: ChildProcess }> {
  const proc = spawn(exe, ["--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--hide-scrollbars", "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${port}`, `--user-data-dir=${profileDir}`, "about:blank"], { stdio: "ignore" });
  proc.on("error", () => {});
  let target: any = null;
  for (let n = 0; n < 75 && !target; n++) {
    try {
      let r = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT", signal: AbortSignal.timeout(3000) });
      if (!r.ok) r = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(3000) });
      if (r.ok) { const j = await r.json(); target = Array.isArray(j) ? j.find((t: any) => t.type === "page") : j; }
    } catch { /* not up yet */ }
    if (!target) await sleep(200);
  }
  if (!target?.webSocketDebuggerUrl) { proc.kill(); throw new Error("browser did not expose a debugging endpoint"); }
  const page = new Page(target.webSocketDebuggerUrl, blockWrites);
  await page.open();
  return { page, proc };
}

const DESKTOP = { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false };
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 1, mobile: true };
/** Owner-required widths: desktop 1440 and 1920, tablet 768, phones 390 and Samsung S24 Ultra (384 CSS px). */
const VIEWPORTS: Array<[string, { width: number; height: number; deviceScaleFactor: number; mobile: boolean }]> = [
  ["desktop", DESKTOP],
  ["wide", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }],
  ["tablet", { width: 768, height: 1024, deviceScaleFactor: 1, mobile: true }],
  ["mobile", MOBILE],
  ["s24ultra", { width: 384, height: 832, deviceScaleFactor: 1, mobile: true }],
];
const overflow: Record<string, string[]> = {};

async function shoot(page: Page, name: string, both = true) {
  for (const [label, vp] of both ? VIEWPORTS : VIEWPORTS.slice(0, 1)) {
    await page.cmd("Emulation.setDeviceMetricsOverride", vp);
    await sleep(label === "desktop" ? 350 : 900);
    await page.eval(MASK_JS).catch(() => {});
    // Horizontal clipping/overflow is a defect at every width.
    const wide = await page.eval(`document.documentElement.scrollWidth>window.innerWidth+1`).catch(() => false);
    if (wide) { (overflow[name] ??= []).push(label); evidence.browser.horizontalOverflow = overflow; }
    // Capture the page down to 2,400 CSS px so whole screens can be reviewed, not just the fold.
    const h = Number(await page.eval(`Math.min(2400,Math.max(document.documentElement.scrollHeight,${vp.height}))`).catch(() => vp.height)) || vp.height;
    const shot = await page.cmd("Page.captureScreenshot", { format: "jpeg", quality: 55, captureBeyondViewport: true, clip: { x: 0, y: 0, width: vp.width, height: h, scale: 1 } });
    saveShot(name, label, shot.data);
  }
  await page.cmd("Emulation.setDeviceMetricsOverride", DESKTOP);
  await sleep(300);
}

const authJson = (s: Sess) => JSON.stringify({ user: { id: s.userId, name: s.name, email: s.email, role: s.role }, session: { access_token: s.token, refresh_token: s.refresh, expires_at: s.expiresAt, csrf_token: s.csrf } });

async function inspect(page: Page, expectedPath: string) {
  return page.eval(`(()=>({path:location.pathname,loginForm:!!document.querySelector('input[type="password"]'),overlay:!!document.querySelector('vite-error-overlay'),notFound:/page not found|404/i.test((document.querySelector('h1,h2')||{}).textContent||''),h1:((document.querySelector('h1')||{}).textContent||'').trim().slice(0,80),textLength:document.body.innerText.length}))()`).then((v: any) => ({ ...v, expected: expectedPath, h1: scrub(String(v.h1 ?? "")) }));
}

/** Visit one page (SPA navigation after the first load), settle, screenshot desktop + mobile, record a check. */
async function visit(page: Page, group: string, id: string, url: string, name: string, opts: { both?: boolean; after?: (p: Page) => Promise<void> } = {}) {
  await run(`browser.${group}.${id}`, "browser", false, async () => {
    const wantPath = url.split("?")[0];
    await budget.reserve(14, `browser page ${id}`);
    const spa = await page.eval(`typeof history!=='undefined'&&location.origin===${JSON.stringify(new URL(BASE).origin)}&&location.pathname!=='/login'&&document.readyState==='complete'`).catch(() => false);
    if (spa) {
      await page.eval(`(()=>{history.pushState({}, '', ${JSON.stringify(url)});window.dispatchEvent(new PopStateEvent('popstate'));return true})()`);
      if (!(await page.poll(`location.pathname===${JSON.stringify(wantPath)}`, 6000))) await page.cmd("Page.navigate", { url: BASE + url });
    } else await page.cmd("Page.navigate", { url: BASE + url });
    await page.poll(`location.pathname===${JSON.stringify(wantPath)}&&document.readyState!=='loading'`, 20_000);
    await sleep(700);
    const settled = await page.settle();
    if (opts.after) await opts.after(page);
    const info = await inspect(page, wantPath);
    await shoot(page, name, opts.both !== false);
    const ok = info.path === wantPath && !info.loginForm && !info.overlay && !info.notFound;
    return { ok, detail: `path ${info.path}${info.loginForm ? " (login form shown)" : ""}${info.overlay ? " (error overlay)" : ""}${info.notFound ? " (not-found page)" : ""}; settled ${settled}; h1 "${info.h1}"`, observed: { ...info, settled } };
  });
}

async function browserPhase() {
  if (SKIP_BROWSER) { await run("browser.available", "browser", false, async () => skip("--skip-browser")); return; }
  if (!ctx.admin && !ctx.student) { await run("browser.available", "browser", false, async () => skip("no sessions")); return; }
  const found = ensureChromium();
  evidence.browser.executable = found.exe ? found.how : "none";
  if (!found.exe) { await run("browser.available", "browser", false, async () => skip("no Chromium found and the Playwright install did not provide one")); return; }
  await run("browser.available", "browser", false, async () => ({ ok: true, detail: `Chromium via ${found.how}` }));

  // Refresh both tokens right before use (waits for the rate budget may have taken a while).
  for (const s of [ctx.admin, ctx.student]) if (s) { await refreshSession(s); await fetchCsrf(s); }

  const run1 = async (label: "admin" | "student", sess: Sess | undefined, port: number, body: (p: Page) => Promise<void>) => {
    if (!sess) { await run(`browser.${label}.session`, "browser", false, async () => skip(`no ${label} session`)); return; }
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), `s26-${label}-`));
    let launched: { page: Page; proc: ChildProcess } | null = null;
    try {
      launched = await launchBrowser(found.exe!, port, profile, true);
      const { page } = launched;
      await page.cmd("Emulation.setDeviceMetricsOverride", DESKTOP);
      await page.cmd("Page.navigate", { url: BASE + "/login" });
      await page.poll(`!!document.querySelector('input[type="email"],input[type="password"]')`, 20_000);
      await page.eval(`localStorage.setItem('lumiere_auth',${JSON.stringify(authJson(sess))});true`);
      await body(page);
      evidence.browser[label] = { apiRequestsAllowed: page.apiRequests, blockedNonGet: page.blocked.length, blockedSample: Array.from(new Set(page.blocked)).slice(0, 25), writesAllowedThrough: page.allowedWrites };
      if (label === "admin") {
        await run("browser.admin.read-only-no-writes-passed-through", "browser", false, async () => ({ ok: page.allowedWrites.length === 0, detail: `${page.blocked.length} non-GET /api requests blocked; ${page.allowedWrites.length} passed through` }));
      }
    } catch (e) {
      await run(`browser.${label}.session`, "browser", false, async () => ({ ok: false, detail: `browser failed: ${short((e as Error).message, 200)}` }));
    } finally {
      launched?.page.close();
      try { launched?.proc.kill(); } catch { /* ignore */ }
      await sleep(400);
      try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  };

  await run1("admin", ctx.admin, 9341, async (page) => {
    const sid = ctx.sid ?? "";
    await visit(page, "admin", "control-center", "/admin/support-center", "admin-control-center");
    await visit(page, "admin", "administration", "/admin", "admin-administration");
    await visit(page, "admin", "billing", `/admin/students/${sid}/billing`, "admin-student-billing");
    await visit(page, "admin", "elective-requests", "/admin/elective-requests", "admin-elective-requests");
    await visit(page, "admin", "support-desk", "/support", "admin-support-desk");
    if (ctx.realStudentId) await visit(page, "admin", "real-student-file", `/admin/students/${ctx.realStudentId}`, "admin-real-student-file");
    await visit(page, "admin", "dossier", `/admin/students/${sid}`, "admin-student-dossier");
    await visit(page, "admin", "high-school", `/admin/students/${sid}/high-school`, "admin-student-high-school");
    await visit(page, "admin", "assistant", `/admin/assistant?studentId=${sid}`, "admin-owner-assistant");
    await visit(page, "admin", "view-as-student", `/admin/students/${sid}/view-as-student`, "admin-view-as-student", {
      after: async (p) => { await p.poll(`!!document.querySelector('[data-testid="preview-banner"]')`, 15_000); },
    });
    // Click through every section tab the preview exposes (desktop only, one screenshot each).
    await run("browser.admin.view-as-student-banner", "browser", false, async () => {
      const banner = await page.eval(`!!document.querySelector('[data-testid="preview-banner"]')`);
      return { ok: !!banner, detail: banner ? "read-only preview banner present" : "preview banner not found" };
    });
    const tabs: string[] = await page.eval(`[...document.querySelectorAll('[data-testid="view-as-student"] [role="tab"]')].map(t=>(t.textContent||'').trim().slice(0,40))`).catch(() => []);
    for (let i = 0; i < tabs.length; i++) {
      await run(`browser.admin.view-as-student.tab-${i + 1}`, "browser", false, async () => {
        await budget.reserve(8, "preview tab");
        const clicked = await page.click(`document.querySelectorAll('[data-testid="view-as-student"] [role="tab"]')[${i}]`);
        await sleep(500);
        const settled = await page.settle(20_000);
        const active = await page.eval(`document.querySelectorAll('[data-testid="view-as-student"] [role="tab"]')[${i}]?.getAttribute('data-state')==='active'`);
        const stillHere = await page.eval(`location.pathname===${JSON.stringify(`/admin/students/${sid}/view-as-student`)}`);
        await shoot(page, `admin-view-as-student-tab-${i + 1}`, false);
        return { ok: clicked && active && stillHere, detail: `tab ${i + 1}/${tabs.length} "${scrub(tabs[i])}" clicked ${clicked}, active ${active}, still on preview ${stillHere}, settled ${settled}` };
      });
    }
  });

  await run1("student", ctx.student, 9342, async (page) => {
    await visit(page, "student", "high-school-flight-deck", "/high-school/flight-deck", "student-high-school-flight-deck");
    await visit(page, "student", "high-school", "/high-school", "student-high-school");
    await run("browser.student.subjects-tab", "browser", false, async () => {
      await budget.reserve(8, "subjects tab");
      const finder = `[...document.querySelectorAll('[role="tab"],button')].find(e=>/^(my )?subjects$|^mes mati[eè]res$|mati[eè]res/i.test((e.textContent||'').trim()))`;
      const clicked = await page.click(finder);
      await sleep(500);
      await page.settle(20_000);
      const open = await page.eval(`!!document.querySelector('[data-testid="tab-subjects"]')||/TEST ONLY/.test(document.body.innerText)`);
      await shoot(page, "student-high-school-subjects");
      return { ok: clicked && !!open, detail: `subjects tab clicked ${clicked}; subjects content visible ${open}` };
    });
    await visit(page, "student", "profile", "/profile", "student-profile");
    await visit(page, "student", "documents", "/documents", "student-documents");
    await visit(page, "student", "billing", "/billing", "student-billing");
    await visit(page, "student", "support", "/support", "student-support");
    await run("browser.student.assistant-widget", "browser", false, async () => {
      await budget.reserve(8, "assistant widget");
      const clicked = await page.click(`document.querySelector('[data-testid="assistant-fab"]')`);
      await sleep(600);
      const open = await page.poll(`!!document.querySelector('[data-testid="assistant-panel"]')`, 8000);
      await page.settle(15_000);
      await shoot(page, "student-assistant-widget");
      return { ok: clicked && open, detail: `assistant launcher clicked ${clicked}; panel open ${open}` };
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------------------------
async function browserSelfTest() {
  // Local harness only (no production access): fake sessions against a mock server to exercise the CDP code.
  const fake = (role: string): Sess => ({ key: role, role, userId: "selftest", name: "Selftest", email: "selftest@example.com", token: "x", refresh: null, expiresAt: Math.floor(Date.now() / 1000) + 3600, csrf: null, csrfAt: 0 });
  ctx.admin = fake("admin"); ctx.student = fake("student"); ctx.sid = "selftest-student";
  await browserPhase();
}

async function main() {
  if (has("--browser-selftest")) { await browserSelfTest(); return; }
  let preflightOk = true;
  await run("preflight", "platform", true, async () => {
    const problems: string[] = [];
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(BASE)) problems.push("--base must be an https origin");
    if (!/^[a-z0-9]{20}$/.test(REF)) problems.push("--ref must be the 20-character Supabase project ref");
    if (process.env.SUPABASE_URL !== `https://${REF}.supabase.co`) problems.push("SUPABASE_URL does not match --ref");
    if (!process.env.DATABASE_URL?.includes(REF)) problems.push("DATABASE_URL does not contain --ref");
    if (!process.env.SUPABASE_SERVICE_KEY) problems.push("SUPABASE_SERVICE_KEY missing");
    if (!process.env.SUPABASE_ANON_KEY) problems.push("SUPABASE_ANON_KEY missing");
    addSecret(process.env.SUPABASE_SERVICE_KEY); addSecret(process.env.SUPABASE_ANON_KEY); addSecret(process.env.DATABASE_URL);
    preflightOk = problems.length === 0;
    return { ok: preflightOk, detail: preflightOk ? `target ${BASE}, project ${REF}, api budget ${API_BUDGET}/15min` : problems.join("; ") };
  });
  evidence.rateLimit = { apiBudgetPer15Min: API_BUDGET, serverLimitPer15Min: 100 };
  if (BASE) await platformChecks();
  if (!preflightOk) { evidence.notes.push("preflight failed: authenticated checks not attempted"); return; }
  await adminChecks();
  if (AI_ONLY) { evidence.notes.push("--ai-only: student, photo, document, support, billing, assistant-write, authorization and browser phases skipped (no writes)"); return; }
  await studentChecks();
  await photoChecks();
  await documentChecks();
  await supportChecks();
  await billingChecks();
  await assistantChecks();
  await authorizationChecks();
  await browserPhase();
}

let finalized = false;
function finalize() {
  if (finalized) return;
  finalized = true;
  summarize();
  const s = evidence.summary;
  evidence.verdict = s.required > 0 && s.requiredPass === s.required ? "PASS" : "FAIL";
  evidence.finishedAt = new Date().toISOString();
  evidence.rateLimit = { ...evidence.rateLimit, apiRequestsCounted: budget.total, budgetWaits: budget.waits, budgetWaitedSeconds: Math.round(budget.waitedMs / 1000) };
  persist();
}

main()
  .catch((e) => { evidence.notes.push(`unhandled: ${short((e as Error)?.message ?? e, 300)}`); })
  .finally(async () => {
    // Revoke only what this run created. Admin: local scope (the owner's other sessions are untouched).
    try { await ctx.adminClient?.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
    // Student: app logout last (revokes the DEMO student's sessions, including the one used by the browser).
    if (ctx.student) {
      try {
        const r = await http("POST", "/api/auth/logout", { session: ctx.student });
        evidence.notes.push(`demo student logout: HTTP ${r.status}`);
      } catch { /* ignore */ }
    }
    finalize();
    const s = evidence.summary;
    log(`verdict ${evidence.verdict}: required ${s.requiredPass}/${s.required} PASS (${s.requiredFail} FAIL, ${s.requiredSkipped} SKIPPED); optional ${s.optionalPass} PASS / ${s.optionalFail} FAIL / ${s.optionalSkipped} SKIPPED; evidence in ${OUT}/acceptance.json`);
    if (!SKIP_AI) log(`AI: functional ${evidence.aiFunctional}; requested model ${evidence.aiModelRequested}; provider-served model ${evidence.aiModelVerification}`);
    process.exit(evidence.verdict === "PASS" ? 0 : 1);
  });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => { evidence.notes.push(`interrupted by ${sig}`); finalize(); process.exit(130); });
}
