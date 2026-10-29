/**
 * S26 — confidential first-student intake, run INSIDE the production Repl by scripts/s26/release-loop.sh
 * after the new build is live. Contains no personal data itself: everything private is read at run time
 * from the git-ignored folder `s26-private-intake/` (the owner's confidential handoff ZIP or its files,
 * plus the student's portrait). Writes s26-evidence/intake.json with field NAMES and statuses only.
 *
 *   npx tsx scripts/s26/private-intake.ts --base https://lumiere-student-portal-v-2.replit.app --ref rheronevecsffaejteoj
 *
 * Acts as the earliest admin through the application's own authenticated APIs (magic-link exchange, no
 * email sent). Idempotent. Never: duplicates the student/guardian, overwrites a stored value, verifies
 * guardian authority, records a signature, payment, school approval, activation or credit, sends an
 * invitation, or publishes the roadmap.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createClient } from "@supabase/supabase-js";

const DIR = "s26-private-intake";
const OUT = "s26-evidence/intake.json";
const arg = (n: string) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] ?? null : null; };
const BASE = (arg("--base") ?? "").replace(/\/+$/, "");
const REF = arg("--ref") ?? "";
const out: Record<string, unknown> = { startedAt: new Date().toISOString(), steps: {} };
const step = (k: string, v: unknown) => { (out.steps as Record<string, unknown>)[k] = v; save(); };
const save = () => { fs.mkdirSync(path.dirname(OUT), { recursive: true }); fs.writeFileSync(OUT, JSON.stringify(out, null, 2)); };
const fail = (code: string): never => { throw new Error(code); };

function findFile(re: RegExp): string | null {
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  return walk(DIR).find((f) => re.test(path.basename(f))) ?? null;
}

function extractZipIfNeeded() {
  if (findFile(/PRIVATE_STUDENT_AND_GUARDIAN_RECORD\.json$/i)) return "files present";
  const zip = findFile(/\.zip$/i);
  if (!zip) fail("INTAKE_FILES_MISSING");
  const dest = path.join(DIR, "extracted");
  fs.mkdirSync(dest, { recursive: true });
  const tries: Array<[string, string[]]> = [["unzip", ["-o", "-q", zip!, "-d", dest]], ["python3", ["-m", "zipfile", "-e", zip!, dest]], ["npx", ["-y", "extract-zip@2.0.1", zip!, path.resolve(dest)]]];
  for (const [cmd, args] of tries) {
    try { execFileSync(cmd, args, { stdio: "ignore" }); if (findFile(/PRIVATE_STUDENT_AND_GUARDIAN_RECORD\.json$/i)) return `extracted with ${cmd}`; } catch { /* next */ }
  }
  return fail("ZIP_EXTRACTION_FAILED");
}

interface Sess { token: string; csrf: string | null }
async function req(method: string, p: string, s: Sess | null, body?: { json?: unknown; form?: FormData }) {
  const headers: Record<string, string> = { accept: "application/json", origin: BASE };
  if (s) headers.authorization = `Bearer ${s.token}`;
  if (s?.csrf && method !== "GET") headers["x-csrf-token"] = s.csrf;
  let payload: BodyInit | undefined;
  if (body?.json !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body.json); }
  else if (body?.form) payload = body.form;
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(BASE + p, { method, headers, body: payload, signal: AbortSignal.timeout(30_000) });
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, Math.min(900, Number(r.headers.get("retry-after")) || 120) * 1000)); continue; }
    const text = await r.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not json */ }
    return { status: r.status, json };
  }
  return { status: 429, json: null };
}
const errOf = (r: { status: number; json: any }) => `${r.status} ${r.json?.code ?? r.json?.error?.code ?? ""} ${typeof r.json?.error === "string" ? r.json.error : r.json?.error?.message ?? ""}`.trim().slice(0, 160);

async function putSigned(url: string, bytes: Buffer, mime: string) {
  const r = await fetch(url, { method: "PUT", headers: { "content-type": mime, "x-upsert": "false" }, body: bytes, signal: AbortSignal.timeout(60_000) });
  if (r.ok) return r.status;
  const fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", new Blob([bytes], { type: mime }));
  return (await fetch(url, { method: "PUT", headers: { "x-upsert": "false" }, body: fd, signal: AbortSignal.timeout(60_000) })).status;
}

async function main() {
  if (!/^[a-z0-9]{20}$/.test(REF) || process.env.SUPABASE_URL !== `https://${REF}.supabase.co`) fail("REF_MISMATCH");
  if (!BASE.startsWith("https://")) fail("BASE_REQUIRED");
  if (!fs.existsSync(DIR)) fail("INTAKE_FOLDER_MISSING");
  step("files", extractZipIfNeeded());
  const record = JSON.parse(fs.readFileSync(findFile(/PRIVATE_STUDENT_AND_GUARDIAN_RECORD\.json$/i)!, "utf8"));
  const studentId: string = record.production?.student_uuid ?? fail("NO_STUDENT_UUID");
  const code: string = record.production?.student_code ?? fail("NO_STUDENT_CODE");

  // Admin session through the app (no email is sent).
  const service = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const admins = await service.from("users").select("id,email").eq("role", "admin").order("created_at", { ascending: true }).limit(1);
  const admin = admins.data?.[0] ?? fail("NO_ADMIN");
  const link = await service.auth.admin.generateLink({ type: "magiclink", email: admin.email });
  const anon = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await anon.auth.verifyOtp({ token_hash: link.data?.properties?.hashed_token ?? fail("LINK_FAILED"), type: "magiclink" });
  if (!signed.data.session) fail("ADMIN_SESSION_FAILED");
  const s: Sess = { token: signed.data.session!.access_token, csrf: null };
  s.csrf = (await req("GET", "/api/csrf-token", s)).json?.csrfToken ?? null;

  try {
    // 1. Existing student (never duplicated).
    const st = await req("GET", `/api/students/${studentId}`, s);
    if (st.status !== 200 || st.json?.student_code !== code) fail("REAL_STUDENT_NOT_FOUND");
    const stored = st.json;
    step("student", { found: true, code, status: stored.status, portalLinked: !!stored.user_id });

    // 2. Fill ONLY empty profile fields from the private record (never overwrite).
    const p = record.student;
    const want: Record<string, unknown> = {
      middle_name: p.legal_middle_names, dob: p.date_of_birth, nationality: p.nationality?.map((n: string) => (/french/i.test(n) ? "FR" : n)),
      phone_primary: p.phone, timezone: p.timezone, address_line1: p.residence_address,
      address_city: p.residence_city, address_postal: p.residence_postal_code, address_country: "MA", hs_country: "MA",
    };
    const empty = (v: unknown) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    const fill = Object.fromEntries(Object.entries(want).filter(([k, v]) => !empty(v) && empty(stored[k])));
    if (Object.keys(fill).length) {
      const u = await req("PUT", `/api/students/${studentId}`, s, { json: fill });
      step("profileFill", { attempted: Object.keys(fill), result: u.status === 200 ? "PASS" : `FAIL ${errOf(u)}` });
    } else step("profileFill", { attempted: [], result: "nothing missing" });

    // 3. Guardian: must already exist; fill only empty email/phone/language; authority untouched.
    const contacts = await req("GET", `/api/students/${studentId}/contacts`, s);
    const list: any[] = Array.isArray(contacts.json) ? contacts.json : contacts.json?.contacts ?? [];
    const mother = list.find((c) => /mother|mère|mere|parent|guardian|représentant/i.test(`${c.relationship ?? ""} ${c.type ?? ""}`));
    if (!mother) step("guardian", { result: "GAP — no guardian contact found; not created by this script" });
    else {
      const g = record.guardian;
      const gFill = Object.fromEntries(Object.entries({ email: g.email, phone: g.phone, language: "fr" }).filter(([k, v]) => v && empty(mother[k])));
      const gr = Object.keys(gFill).length ? await req("PUT", `/api/students/contacts/${mother.id}`, s, { json: gFill }) : null;
      step("guardian", { found: true, filled: Object.keys(gFill), fillResult: gr ? (gr.status === 200 ? "PASS" : `FAIL ${errOf(gr)}`) : "nothing missing", authorityStatus: mother.authorityStatus ?? mother.authority_status ?? "unknown (unchanged)" });
    }

    // 4. Portrait (actual photo supplied by the owner), via the authenticated photo endpoint.
    const photo = findFile(/\.(jpe?g|png|webp)$/i);
    if (stored.photo_url) step("photo", { result: "already on file (unchanged)" });
    else if (!photo) step("photo", { result: "GAP — no portrait file in s26-private-intake/" });
    else {
      const bytes = fs.readFileSync(photo);
      const mime = /\.png$/i.test(photo) ? "image/png" : /\.webp$/i.test(photo) ? "image/webp" : "image/jpeg";
      const before = stored.photo_url ? "had photo" : "no photo";
      const fd = new FormData(); fd.append("photo", new Blob([bytes], { type: mime }), `portrait${path.extname(photo).toLowerCase()}`);
      const up = await req("POST", `/api/students/${studentId}/photo`, s, { form: fd });
      const reload = await req("GET", `/api/students/${studentId}/profile`, s);
      const signedUrl = reload.json?.identity?.photoUrl;
      const fetched = typeof signedUrl === "string" ? await fetch(signedUrl, { signal: AbortSignal.timeout(20_000) }) : null;
      step("photo", { before, bytes: bytes.length, mime, upload: up.status === 200 ? "PASS" : `FAIL ${errOf(up)}`, reloadSignedUrl: fetched?.ok ? "PASS (private bucket, short-lived signed URL)" : "FAIL" });
    }

    // 5. Contract PDF as a PRIVATE student document (pending: proposal, not signed).
    const pdf = findFile(/CONTRACT.*\.pdf$/i) ?? findFile(/\.pdf$/i);
    const docs = await req("GET", `/api/documents/student/${studentId}`, s);
    const existing = (Array.isArray(docs.json) ? docs.json : []).find((d: any) => d.doc_type === "consent_form" && /contrat|contract|convention/i.test(`${d.file_name ?? ""} ${d.notes ?? ""}`));
    if (existing) step("contract", { result: "already on file", status: existing.status });
    else if (!pdf) step("contract", { result: "GAP — contract PDF not found in intake folder" });
    else {
      const bytes = fs.readFileSync(pdf);
      const fileName = "Lumiere-convention-proposee-signature-ready.pdf";
      const urlRes = await req("POST", `/api/documents/student/${studentId}/upload-url`, s, { json: { doc_type: "consent_form", file_name: fileName, file_size: bytes.length, mime_type: "application/pdf" } });
      const uploadUrl = urlRes.json?.uploadUrl ?? urlRes.json?.signedUrl ?? urlRes.json?.upload_url;
      const storagePath = urlRes.json?.storagePath ?? urlRes.json?.storage_path ?? urlRes.json?.path;
      if (urlRes.status !== 200 || !uploadUrl) step("contract", { result: `FAIL upload-url ${errOf(urlRes)}` });
      else {
        const put = await putSigned(uploadUrl, bytes, "application/pdf");
        const rec = await req("POST", `/api/documents/student/${studentId}`, s, { json: {
          doc_type: "consent_form", file_name: fileName, storage_path: storagePath, visibility: "staff_only",
          notes: "Proposed Lumière agreement (25 pages), signature-ready. NOT signed by both parties; payment NOT received. Internal: contains private billing details.",
        } });
        step("contract", { put, record: rec.status === 201 ? "PASS (private bucket; pending review)" : `FAIL ${errOf(rec)}` });
      }
    }

    // 6. Billing: proposed agreement amount only (no receipt, no installment date, nothing paid).
    const bill = await req("GET", `/api/admin/students/${studentId}/billing`, s);
    const agreed = bill.json?.student?.state === "configured" ? bill.json.student.agreedCents : null;
    const price = Math.round(Number(record.contract?.price_usd) * 100);
    if (bill.status !== 200) step("billing", { result: `FAIL read ${errOf(bill)}` });
    else if (agreed !== null && agreed !== undefined) step("billing", { result: "obligation already recorded (unchanged)", matchesProposal: agreed === price });
    else if (!Number.isFinite(price) || price <= 0) step("billing", { result: "GAP — no price in private record" });
    else {
      const ob = await req("POST", `/api/admin/students/${studentId}/billing/obligation`, s, { json: { agreedCents: price, currency: "USD", note: "PROPOSED agreement — payable in full at two-party signature. NOT signed, NOT paid, no receipt recorded." } });
      step("billing", { result: ob.status === 200 ? "PASS (proposed obligation; 0 paid)" : `FAIL ${errOf(ob)}` });
    }
    out.verdict = "DONE";
  } finally {
    try { await anon.auth.signOut({ scope: "local" }); } catch { /* ignore */ }
  }
}

main().catch((e) => { out.verdict = "FAIL"; out.blocker = /^[A-Z_]+$/.test(e?.message) ? e.message : "INTAKE_ERROR"; process.exitCode = 1; })
  .finally(() => { out.finishedAt = new Date().toISOString(); save(); });
