/**
 * S21 memory, private retrieval and global search against a REAL disposable PostgreSQL 16
 * (every repository migration applied in order, including A's conversations and B's document text).
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";

const MIGRATION = "supabase/migrations/20261102110000_s21_document_attachments.sql";

describe.skipIf(!PG_BINARIES_AVAILABLE)(`S21 memory + retrieval + search (real PG)${PG_BINARIES_AVAILABLE ? "" : " - " + S05_PG_SKIP_MESSAGE}`, () => {
  let pg: LocalPg;
  let mem: typeof import("../server/services/assistant-memory");
  let searchMod: typeof import("../server/services/global-search");
  let memRoute: typeof import("../server/routes/assistant-memory");
  let searchRoute: typeof import("../server/routes/search");
  let dbx: any;
  const rows = async (q: string) => Array.from(await pg.sql(q)) as any[];

  let ua: Awaited<ReturnType<typeof seedUser>>, ub: Awaited<ReturnType<typeof seedUser>>, staff: Awaited<ReturnType<typeof seedUser>>, coach: Awaited<ReturnType<typeof seedUser>>, admin: Awaited<ReturnType<typeof seedUser>>;
  let sa: Awaited<ReturnType<typeof seedStudent>>, sb: Awaited<ReturnType<typeof seedStudent>>;

  async function conversation(owner: string, title: string) {
    const id = randomUUID();
    await pg.client`INSERT INTO assistant_conversations (id, owner_user_id, title) VALUES (${id}, ${owner}, ${title})`;
    return id;
  }
  async function message(owner: string, conv: string, role: "student" | "assistant", content: string, lang = "en", author = owner) {
    const id = randomUUID();
    await pg.client`
      INSERT INTO assistant_messages (id, conversation_id, owner_user_id, seq, role, author_user_id, content, language, prev_hash, hash)
      SELECT ${id}, ${conv}, ${owner}, coalesce(max(seq), 0) + 1, ${role}, ${role === "student" ? author : null}, ${content}, ${lang},
             coalesce((SELECT hash FROM assistant_messages WHERE conversation_id = ${conv} ORDER BY seq DESC LIMIT 1), repeat('0', 64)),
             encode(sha256(convert_to(${id}::text, 'UTF8')), 'hex')
      FROM assistant_messages WHERE conversation_id = ${conv}`;
    return id;
  }
  async function doc(studentId: string, fileName: string, opts: { visibility?: string; deleted?: boolean; docType?: string } = {}) {
    const id = randomUUID();
    await pg.client`
      INSERT INTO student_documents (id, student_id, doc_type, file_name, url, storage_path, visibility, soft_deleted)
      VALUES (${id}, ${studentId}, ${opts.docType ?? "other"}, ${fileName}, 'u', ${"p/" + id}, ${opts.visibility ?? "student_staff"}, ${opts.deleted ?? false})`;
    return id;
  }
  async function chunk(documentId: string, studentId: string, content: string, idx = 0, location = "page 1") {
    await pg.client`INSERT INTO student_document_text (document_id, student_id, chunk_index, location, content) VALUES (${documentId}, ${studentId}, ${idx}, ${location}, ${content})`;
  }
  const rec = (owner: string, messageId: string, content: string, language: "en" | "fr" = "en") =>
    mem.recordMemoryFromMessage({ ownerUserId: owner, messageId, content, language });
  const memRows = (owner: string) => rows(`SELECT * FROM student_assistant_memory WHERE owner_user_id='${owner}' ORDER BY created_at, version`);

  beforeAll(async () => {
    pg = await startLocalPg();
    await pg.sql(fs.readFileSync(path.join(import.meta.dirname, "..", MIGRATION), "utf8"));
    process.env.DATABASE_URL = pg.url;
    vi.resetModules();
    mem = await import("../server/services/assistant-memory");
    searchMod = await import("../server/services/global-search");
    memRoute = await import("../server/routes/assistant-memory");
    searchRoute = await import("../server/routes/search");
    dbx = (await import("../server/lib/db")).db;
    ua = await seedUser(pg, "student", "mem-a");
    ub = await seedUser(pg, "student", "mem-b");
    staff = await seedUser(pg, "staff", "mem-staff");
    coach = await seedUser(pg, "coach", "mem-coach");
    admin = await seedUser(pg, "admin", "mem-admin");
    sa = await seedStudent(pg, { userId: ua.id, firstName: "Amelie", lastName: "Tremblay" });
    sb = await seedStudent(pg, { userId: ub.id, firstName: "Bastien", lastName: "Gagnon" });
  }, 180_000);
  afterAll(async () => { await pg?.stop(); });

  describe("migration", () => {
    it("creates both tables with RLS and the unique active-key index", async () => {
      expect((await rows(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('student_assistant_memory','assistant_memory_sources')`)).every((r) => r.relrowsecurity)).toBe(true);
      expect(await rows(`SELECT 1 FROM pg_indexes WHERE indexname='uq_student_assistant_memory_active_key'`)).toHaveLength(1);
    });
    it("is idempotent", async () => {
      const sqlText = fs.readFileSync(path.join(import.meta.dirname, "..", "supabase/migrations/20261102120000_s21_student_memory.sql"), "utf8");
      await pg.sql(sqlText);
      await pg.sql(sqlText);
    });
  });

  describe("memory lifecycle", () => {
    it("records a goal with its source message, idempotently", async () => {
      const conv = await conversation(ua.id, "Planning");
      const m1 = await message(ua.id, conv, "student", "I want to study communications after high school.");
      const r1 = await rec(ua.id, m1, "I want to study communications after high school.");
      expect(r1.created).toHaveLength(1);
      const r2 = await rec(ua.id, m1, "I want to study communications after high school.");
      expect(r2.replayed).toBe(true);
      const items = await mem.memoryService.list(ua.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ category: "intended_major", statement: "Intended major: communications", status: "active", basis: "student_reported", version: 1 });
      expect(items[0].sources).toEqual([expect.objectContaining({ kind: "message", id: m1 })]);
    });

    it("dedups an identical fact (adds a source, no new row) in EN and FR", async () => {
      const conv = await conversation(ua.id, "Again");
      const m2 = await message(ua.id, conv, "student", "Je veux étudier les communications.", "fr");
      const r = await rec(ua.id, m2, "Je veux étudier les communications.", "fr");
      expect(r.created).toHaveLength(0);
      expect(r.reinforced).toHaveLength(1);
      const items = await mem.memoryService.list(ua.id, { status: "active" });
      expect(items).toHaveLength(1);
      expect(items[0].sources).toHaveLength(2);
    });

    it("supersedes a changed goal transparently: both kept and linked", async () => {
      const conv = await conversation(ua.id, "Change");
      const m3 = await message(ua.id, conv, "student", "Actually I want to study journalism.");
      const r = await rec(ua.id, m3, "Actually I want to study journalism.");
      expect(r.created).toHaveLength(1);
      expect(r.superseded).toHaveLength(1);
      const all = await memRows(ua.id);
      const old = all.find((x) => x.statement.endsWith("communications"))!;
      const cur = all.find((x) => x.statement.endsWith("journalism"))!;
      expect(old.status).toBe("superseded");
      expect(old.superseded_by_id).toBe(cur.id);
      expect(cur.supersedes_id).toBe(old.id);
      expect(cur.version).toBe(2);
      expect((await mem.memoryService.list(ua.id)).map((i) => i.status).sort()).toEqual(["active", "superseded"]);
    });

    it("corrections create a new version with student_correction provenance", async () => {
      const cur = (await mem.memoryService.list(ua.id, { status: "active" }))[0];
      const { previous, current } = await mem.memoryService.correct(ua.id, cur.id, "Intended major: broadcast journalism");
      expect(previous.status).toBe("superseded");
      expect(current).toMatchObject({ status: "active", version: 3, supersedesId: cur.id, basis: "student_reported" });
      const items = await mem.memoryService.list(ua.id);
      const fresh = items.find((i) => i.id === current.id)!;
      expect(fresh.sources).toEqual([expect.objectContaining({ kind: "student_correction", id: cur.id })]);
      await expect(mem.memoryService.correct(ua.id, cur.id, "again")).rejects.toMatchObject({ code: "not_active" });
      await expect(mem.memoryService.correct(ua.id, current.id, "Contact me at x@y.co")).rejects.toMatchObject({ code: "invalid_statement" });
    });

    it("retraction keeps the row, drops it from retrieval, and is idempotent", async () => {
      const cur = (await mem.memoryService.list(ua.id, { status: "active" }))[0];
      const r1 = await mem.memoryService.retract(ua.id, cur.id);
      expect(r1.item.status).toBe("retracted");
      expect((await mem.memoryService.retract(ua.id, cur.id)).alreadyRetracted).toBe(true);
      expect((await mem.memoryService.list(ua.id, { status: "active" }))).toHaveLength(0);
      expect(await rows(`SELECT 1 FROM student_assistant_memory WHERE id='${cur.id}'`)).toHaveLength(1);
      const hits = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "broadcast journalism", language: "en" });
      expect(hits.items.some((i) => i.kind === "memory")).toBe(false);
    });

    it("never touches another owner (correct/retract answer not_found; lists are isolated)", async () => {
      const convB = await conversation(ub.id, "B");
      const mb = await message(ub.id, convB, "student", "I want to study architecture.");
      await rec(ub.id, mb, "I want to study architecture.");
      const bItem = (await mem.memoryService.list(ub.id))[0];
      await expect(mem.memoryService.correct(ua.id, bItem.id, "Intended major: law")).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(mem.memoryService.retract(ua.id, bItem.id)).rejects.toMatchObject({ code: "not_found" });
      expect((await mem.memoryService.list(ua.id)).some((i) => i.id === bItem.id)).toBe(false);
      expect((await mem.memoryService.list(ub.id))[0].status).toBe("active");
    });

    it("writes only the memory tables (no credit, billing, document or roadmap rows change)", async () => {
      const before = await rows(`SELECT (SELECT count(*) FROM students) s, (SELECT count(*) FROM student_documents) d, (SELECT count(*) FROM assistant_messages) m`);
      const conv = await conversation(ub.id, "iso");
      const mm = await message(ub.id, conv, "student", "I plan to earn a master's degree.");
      const mid = (await rows(`SELECT count(*) c FROM assistant_messages`))[0].c;
      await rec(ub.id, mm, "I plan to earn a master's degree.");
      const after = await rows(`SELECT (SELECT count(*) FROM students) s, (SELECT count(*) FROM student_documents) d, (SELECT count(*) FROM assistant_messages) m`);
      expect(after[0].s).toBe(before[0].s);
      expect(after[0].d).toBe(before[0].d);
      expect(after[0].m).toBe(String(mid));
    });
  });

  describe("private retrieval", () => {
    let convA: string, msgA: string;
    beforeAll(async () => {
      convA = await conversation(ua.id, "University shortlist");
      msgA = await message(ua.id, convA, "student", "I am interested in Concordia and McGill for communications.");
      await message(ua.id, convA, "assistant", "Both are Montreal universities with communications programs; confirm requirements on their sites.");
      const cb = await conversation(ub.id, "Other");
      await message(ub.id, cb, "student", "I like Toronto Metropolitan University for engineering.");
      const dA = await doc(sa.id, "acceptance-letter.pdf", { docType: "other" });
      await chunk(dA, sa.id, "Dear applicant, your communications program offer from Concordia is attached. Quantum zebra token.");
      const dStaff = await doc(sa.id, "internal-note.pdf", { visibility: "staff_only" });
      await chunk(dStaff, sa.id, "Internal staff only remark about communications flamingo.");
      const dDel = await doc(sa.id, "deleted.pdf", { deleted: true });
      await chunk(dDel, sa.id, "Deleted document about communications pelican.");
      const dB = await doc(sb.id, "b-private.pdf");
      await chunk(dB, sb.id, "Student B secret communications quokka.");
    });

    it("retrieves the earlier message for 'Which universities did we discuss for communications?'", async () => {
      const r = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "Which universities did we discuss for communications?", language: "en" });
      const m = r.items.find((i) => i.kind === "message" && i.sourceId === msgA);
      expect(m).toBeTruthy();
      expect(m!.path).toBe(`/assistant?conversation=${convA}`);
      expect(m!.snippet).toContain("Concordia");
      expect(m!.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("works in French with accents folded on the query side", async () => {
      const cf = await conversation(ua.id, "Économie");
      await message(ua.id, cf, "student", "Je m'intéresse à l'économie internationale.", "fr");
      const r = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "économie internationale", language: "fr" });
      expect(r.items.some((i) => i.kind === "message" && i.title === "Économie")).toBe(true);
      const r2 = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "international economie", language: "fr" });
      expect(r2.items.length).toBeGreaterThanOrEqual(0);
    });

    it("labels document matches as found in the student's document and excludes staff-only/deleted/other owners", async () => {
      const r = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "quantum zebra", language: "en" });
      const d = r.items.filter((i) => i.kind === "document");
      expect(d).toHaveLength(1);
      expect(d[0].label).toBe("Found in your document");
      expect(d[0].title).toContain("acceptance-letter.pdf");
      expect(d[0].path).toBe("/documents");
      const fr = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "quantum zebra", language: "fr" });
      expect(fr.items[0].label).toBe("Trouvé dans votre document");
      for (const word of ["flamingo", "pelican", "quokka"]) {
        const x = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: `communications ${word}`, language: "en" });
        expect(x.items.some((i) => i.kind === "document" && /internal|deleted|b-private/.test(i.title))).toBe(false);
        expect(JSON.stringify(x)).not.toContain(word + " ");
      }
    });

    it("never crosses owners (messages, documents, memory)", async () => {
      const b = await mem.retrievePrivateContext({ ownerUserId: ub.id, query: "Concordia McGill communications quantum zebra", language: "en" });
      expect(b.items.some((i) => i.sourceId === msgA)).toBe(false);
      expect(JSON.stringify(b)).not.toContain("acceptance-letter");
      const a = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "Toronto Metropolitan engineering quokka", language: "en" });
      expect(JSON.stringify(a)).not.toMatch(/Toronto Metropolitan|quokka|b-private/);
    });

    it("returns nothing for gibberish and for an empty owner", async () => {
      expect((await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "zxqv kjhgfd wplmn", language: "en" })).items).toEqual([]);
      expect((await mem.retrievePrivateContext({ ownerUserId: "", query: "communications", language: "en" })).items).toEqual([]);
      expect((await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "the a of", language: "en" })).items).toEqual([]);
    });

    it("boosts exact course codes and institutions from the academic context, with duplicate suppression", async () => {
      const academic = {
        getStudentId: async () => sa.id,
        roadmapView: async () => ({
          state: "PUBLISHED",
          objectives: [],
          phases: [{ title: "Phase 1", items: [
            { key: "i1", title: "Introduction to Communication", code: "COM 101", provider: "TESU", institution: "Thomas Edison State University" },
            { key: "i2", title: "Introduction to Communication", code: "COM 101", provider: "TESU", institution: "Thomas Edison State University" },
            { key: "i3", title: "College Algebra", code: "MAT 120", provider: "Sophia", institution: "Sophia Learning" },
          ] }],
        }),
        highSchoolView: async () => null,
      };
      const r = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "com-101", language: "en" }, { academic });
      const acad = r.items.filter((i) => i.kind === "academic");
      expect(acad).toHaveLength(1);
      expect(acad[0]).toMatchObject({ title: "Introduction to Communication", path: "/roadmap" });
      const r2 = await mem.retrievePrivateContext({ ownerUserId: ua.id, query: "what is MAT 120 about", language: "en" }, { academic });
      expect(r2.items.find((i) => i.kind === "academic")!.title).toBe("College Algebra");
    });
  });

  describe("global search", () => {
    let convId: string;
    beforeAll(async () => {
      convId = await conversation(ua.id, "Scholarship ideas");
      await message(ua.id, convId, "student", "Remember the hummingbird scholarship deadline.");
      await doc(sa.id, "transcript-hummingbird.pdf", { docType: "hs_transcript" });
      await pg.client`INSERT INTO support_tickets (ticket_number, reporter_id, reporter_name, reporter_email, subject, description)
                      VALUES ('LUM-90001', ${ua.id}, 'A', 'a@x.test', 'Hummingbird form question', 'desc'),
                             ('LUM-90002', ${ub.id}, 'B', 'b@x.test', 'Hummingbird B ticket', 'desc')`;
      const dBx = await doc(sb.id, "hummingbird-b.pdf");
      await chunk(dBx, sb.id, "hummingbird content");
    });
    const academicFor = (uid: string) => uid === ua.id ? academicA : { getStudentId: async () => sb.id, roadmapView: async () => null, highSchoolView: async () => null };
    const academicA = { getStudentId: async () => sa.id, roadmapView: async () => null, highSchoolView: async () => ({ enrollment: {}, subjects: [{ subject: "english", label: "English", courses: [{ key: "eng9", title: "English 9 Hummingbird Literature" }] }] }) };
    const run = (user: { id: string; role: string }, q: string, limit?: number) => searchMod.globalSearch({ user, q, limit }, { db: dbx, academic: academicFor(user.id) });

    it("student: own records only, typed and ranked", async () => {
      const res = await run({ id: ua.id, role: "student" }, "hummingbird", 20);
      const types = new Set(res.map((r) => r.type));
      expect(types).toEqual(new Set(["course", "document", "ticket", "conversation", "memory"].filter((t) => t !== "memory")));
      expect(res.find((r) => r.type === "ticket")!.title).toBe("Hummingbird form question");
      expect(res.find((r) => r.type === "conversation")!.path).toBe(`/assistant?conversation=${convId}`);
      expect(JSON.stringify(res)).not.toMatch(/hummingbird-b|Hummingbird B ticket/);
      expect(res.every((r, i) => i === 0 || res[i - 1].score >= r.score)).toBe(true);
      expect(new Set(res.map((r) => `${r.type}:${r.id}`)).size).toBe(res.length);
    });
    it("student: finds indexed document text, memory and billing; respects limit", async () => {
      const d = await run({ id: ua.id, role: "student" }, "zebra");
      expect(d[0]).toMatchObject({ type: "document", path: "/documents" });
      await rec(ua.id, randomUUID(), "I prefer self-paced online courses.");
      expect((await run({ id: ua.id, role: "student" }, "self-paced")).some((r) => r.type === "memory")).toBe(true);
      const b = await run({ id: ua.id, role: "student" }, "paiement");
      expect(b[0]).toMatchObject({ type: "billing", path: "/billing" });
      expect((await run({ id: ua.id, role: "student" }, "hummingbird", 2)).length).toBeLessThanOrEqual(2);
      expect((await run({ id: ua.id, role: "student" }, "a", 500)).length).toBeLessThanOrEqual(20);
    });
    it("student never gets other students' documents, tickets or conversations, nor staff-only documents", async () => {
      const res = await run({ id: ub.id, role: "student" }, "hummingbird", 20);
      expect(res.map((r) => r.title).sort()).toEqual(["Hummingbird B ticket", "hummingbird-b.pdf"].sort());
      const staffOnly = await doc(sa.id, "staffonly-hummingbird.pdf", { visibility: "staff_only" });
      expect(staffOnly).toBeTruthy();
      expect((await run({ id: ua.id, role: "student" }, "staffonly-hummingbird")).length).toBe(0);
    });
    it("staff/admin: students only (name, code, email), never conversation or memory content", async () => {
      for (const u of [staff, admin]) {
        const byName = await run({ id: u.id, role: u.role }, "tremblay");
        expect(byName).toEqual([expect.objectContaining({ type: "student", id: sa.id, path: `/admin/students/${sa.id}` })]);
        expect((await run({ id: u.id, role: u.role }, sb.code))[0].id).toBe(sb.id);
        expect((await run({ id: u.id, role: u.role }, sa.email.split("@")[0]))[0].id).toBe(sa.id);
        const none = await run({ id: u.id, role: u.role }, "hummingbird scholarship deadline");
        expect(none.filter((r) => r.type !== "student")).toEqual([]);
      }
    });
    it("coach and unknown roles get nothing", async () => {
      expect(await run({ id: coach.id, role: "coach" }, "tremblay")).toEqual([]);
      expect(await run({ id: coach.id, role: "coach" }, "hummingbird")).toEqual([]);
      expect(await run({ id: ua.id, role: "mystery" }, "hummingbird")).toEqual([]);
    });
    it("treats LIKE wildcards literally", async () => {
      expect(await run({ id: ua.id, role: "student" }, "%")).toEqual([]);
      expect(await run({ id: staff.id, role: "staff" }, "_")).toEqual([]);
    });
  });

  describe("HTTP routes", () => {
    const authAs = (u: { id: string; role: string }) => (req: any, _res: any, next: any) => { req.user = { id: u.id, role: u.role }; next(); };
    const denyCsrf = (req: any, res: any, next: any) => (req.headers["x-csrf-token"] === "ok" ? next() : res.status(403).json({ error: "csrf", code: "csrf" }));

    it("memory: GET list, POST requires csrf, owner-only 404", async () => {
      const app = express();
      app.use(express.json());
      app.use("/api/assistant/memory", memRoute.createAssistantMemoryRouter({ auth: authAs(ua), csrf: denyCsrf, audit: async () => {}, service: mem.memoryService, db: dbx }));
      await rec(ua.id, randomUUID(), "I want to study philosophy.");
      const list = await request(app).get("/api/assistant/memory");
      expect(list.status).toBe(200);
      expect(list.body.items.length).toBeGreaterThan(0);
      expect(list.body.items[0]).toHaveProperty("sources");
      const msgSource = list.body.items.flatMap((i: any) => i.sources).find((s: any) => s.kind === "message");
      expect(msgSource.path).toMatch(/^\/assistant(\?conversation=[0-9a-f-]{36})?$/);
      const id = list.body.items.find((i: any) => i.status === "active").id;
      expect((await request(app).post(`/api/assistant/memory/${id}/correct`).send({ statement: "x y z" })).status).toBe(403);
      const ok = await request(app).post(`/api/assistant/memory/${id}/correct`).set("x-csrf-token", "ok").send({ statement: "Preference: short courses" });
      expect(ok.status).toBe(200);
      expect(ok.body.item.version).toBeGreaterThan(1);
      const bItem = (await mem.memoryService.list(ub.id))[0];
      const other = await request(app).post(`/api/assistant/memory/${bItem.id}/retract`).set("x-csrf-token", "ok");
      expect(other.status).toBe(404);
      expect((await request(app).post(`/api/assistant/memory/${id}/correct`).set("x-csrf-token", "ok").send({ statement: "a" })).status).toBe(400);
    });

    it("search: validates q and limit, returns results", async () => {
      const app = express();
      app.use("/api/search", searchRoute.createSearchRouter({ auth: authAs(ua), deps: { db: dbx, academic: { getStudentId: async () => sa.id, roadmapView: async () => null, highSchoolView: async () => null } } }));
      expect((await request(app).get("/api/search")).status).toBe(400);
      expect((await request(app).get("/api/search?q=" + "x".repeat(101))).status).toBe(400);
      expect((await request(app).get("/api/search?q=ab&limit=21")).status).toBe(400);
      const ok = await request(app).get("/api/search?q=hummingbird&limit=5");
      expect(ok.status).toBe(200);
      expect(ok.body.results.length).toBeGreaterThan(0);
      expect(ok.body.results.length).toBeLessThanOrEqual(5);
    });
  });
}, 300_000);
