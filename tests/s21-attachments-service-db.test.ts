/**
 * S21 chat attachments against a REAL disposable PostgreSQL 16: migration chain, finalize pipeline,
 * quota, de-duplication, ownership, index invalidation. Storage is an in-memory fake (external service);
 * the router, service, repository, extraction and Postgres are real. Synthetic data only.
 */
import fs from "node:fs";
import path from "node:path";
import express, { type Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PG_BINARIES_AVAILABLE, S05_PG_SKIP_MESSAGE, seedStudent, seedUser, startLocalPg, type LocalPg } from "./helpers/s05-local-pg";
import { EXE_BYTES, PNG_BYTES, buildDocx, buildPdf, buildXlsx } from "./helpers/s21-attachment-fixtures";

if (!PG_BINARIES_AVAILABLE) console.warn(S05_PG_SKIP_MESSAGE);

const MIGRATION = "supabase/migrations/20261102110000_s21_document_attachments.sql";
const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

describe.skipIf(!PG_BINARIES_AVAILABLE)("S21 chat attachments on real Postgres", () => {
  let pg: LocalPg;
  let app: Express;
  const objects = new Map<string, Buffer>();
  const removed: string[] = [];
  const users = new Map<string, { id: string; student_code: string }>();
  let a: { userId: string; id: string; code: string };
  let b: { userId: string; id: string; code: string };
  let invalidate: (id: string) => Promise<void>;
  let chunksApi: typeof import("../server/services/chat-attachments/chunks");
  let storageApi: any;

  const csrf = { "x-csrf-token": "t" };
  const as = (u: { userId: string }) => ({ "x-user-id": u.userId, ...csrf });

  async function upload(u: typeof a, fileName: string, bytes: Buffer, mimeType: string) {
    const r = await request(app).post("/api/student/attachments/upload-url").set(as(u)).send({ fileName, sizeBytes: bytes.length, mimeType });
    if (r.status === 200) objects.set(r.body.storagePath, bytes);
    return r;
  }
  async function finalize(u: typeof a, storagePath: string, fileName: string) {
    return request(app).post("/api/student/attachments/finalize").set(as(u)).send({ storagePath, fileName });
  }
  async function attach(u: typeof a, fileName: string, bytes: Buffer, mimeType: string) {
    const up = await upload(u, fileName, bytes, mimeType);
    expect(up.status).toBe(200);
    return { up, fin: await finalize(u, up.body.storagePath, fileName) };
  }
  const rows = async (sqlText: string) => Array.from(await pg.sql(sqlText)) as any[];

  beforeAll(async () => {
    pg = await startLocalPg();
    // student_documents is created by the disposable supplement AFTER the supabase migrations, so the guarded
    // parts of the S21 migration no-op in the chain. Re-apply it (idempotent), exactly like the S18 harness entry.
    await pg.sql(fs.readFileSync(path.join(import.meta.dirname, "..", MIGRATION), "utf8"));

    process.env.DATABASE_URL = pg.url;
    vi.resetModules();
    vi.doMock("../server/lib/supabase", () => ({
      supabaseAdmin: { auth: {}, from: () => ({}), storage: { from: () => ({ getPublicUrl: (p: string) => ({ data: { publicUrl: `https://public/${p}` } }) }) } },
      isSupabaseConfigured: false,
    }));
    const { documentStorage } = await import("../server/lib/document-storage");
    const { createAttachmentService } = await import("../server/services/chat-attachments/service");
    const { drizzleAttachmentRepo } = await import("../server/services/chat-attachments/repo");
    const { createStudentAttachmentsRouter } = await import("../server/routes/student-attachments");
    ({ invalidateDocumentIndex: invalidate } = await import("../server/services/chat-attachments/invalidate"));
    chunksApi = await import("../server/services/chat-attachments/chunks");

    storageApi = {
      async createSignedUpload(code: string, name: string) {
        const storagePath = documentStorage.generateStoragePath(code, "chat_attachment", name);
        return { uploadUrl: "https://upload", uploadToken: "tok", storagePath, expiresIn: 3600 };
      },
      async stat(p: string) {
        const o = objects.get(p);
        return o ? { size: o.length } : null;
      },
      async download(p: string) {
        const o = objects.get(p);
        if (!o) throw new Error("missing");
        return o;
      },
      async remove(p: string) {
        removed.push(p);
        objects.delete(p);
      },
      publicUrl: (p: string) => `https://public/${p}`,
    };
    const service = createAttachmentService({ repo: drizzleAttachmentRepo, storage: storageApi, defaultQuotaBytes: () => 250 * 1024 * 1024 });

    for (const label of ["a", "b"]) {
      const user = await seedUser(pg, "student", label);
      const st = await seedStudent(pg, { userId: user.id });
      const rec = { userId: user.id, id: st.id, code: st.code };
      users.set(user.id, { id: st.id, student_code: st.code });
      if (label === "a") a = rec;
      else b = rec;
    }

    app = express();
    app.use(express.json());
    app.use(
      "/api/student/attachments",
      createStudentAttachmentsRouter({
        service,
        auth: (req, _res, next) => {
          req.user = { id: String(req.header("x-user-id")), role: "student" } as any;
          next();
        },
        csrf: (_req, _res, next) => next(),
        getStudentByUserId: async (id) => users.get(id) ?? null,
        rateLimitPerMinute: 10_000,
      }),
    );
  }, 180_000);

  afterAll(async () => {
    await pg?.stop();
  });

  describe("migration", () => {
    it("is in the chain and idempotent on re-apply", async () => {
      expect(pg.appliedFiles).toContain(MIGRATION);
      const text = fs.readFileSync(path.join(import.meta.dirname, "..", MIGRATION), "utf8");
      await pg.sql(text);
      await pg.sql(text);
    });
    it("adds the columns, tables, enum value and indexes", async () => {
      const cols = (await rows(`SELECT column_name FROM information_schema.columns WHERE table_name='student_documents'`)).map((r) => r.column_name);
      for (const c of ["source", "mime_type", "size_bytes", "content_sha256", "extraction_status"]) expect(cols).toContain(c);
      expect((await rows(`SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='doc_type_enum' AND e.enumlabel='chat_attachment'`))).toHaveLength(1);
      const t = (await rows(`SELECT column_name FROM information_schema.columns WHERE table_name='student_document_text'`)).map((r) => r.column_name);
      for (const c of ["id", "document_id", "student_id", "chunk_index", "location", "content", "search_vector", "created_at"]) expect(t).toContain(c);
      const q = (await rows(`SELECT column_name FROM information_schema.columns WHERE table_name='student_storage_quota'`)).map((r) => r.column_name);
      expect(q).toEqual(expect.arrayContaining(["student_id", "quota_bytes", "updated_by", "updated_at"]));
      expect((await rows(`SELECT relrowsecurity FROM pg_class WHERE relname IN ('student_document_text','student_storage_quota')`)).every((r) => r.relrowsecurity)).toBe(true);
      expect((await rows(`SELECT 1 FROM pg_indexes WHERE tablename='student_document_text' AND indexdef ILIKE '%gin%'`)).length).toBeGreaterThan(0);
    });
    it("existing rows default to source 'documents' and the generic path cannot create chat rows or required chat rows", async () => {
      const ins = (docType: string, source: string, required: boolean) =>
        pg.sql(`INSERT INTO student_documents (student_id, doc_type, file_name, url, storage_path, source, required_for_enrollment)
                VALUES ('${a.id}', '${docType}', 'x.pdf', 'u', 'p${Math.random()}', '${source}', ${required})`);
      await ins("other", "documents", false);
      const def = await rows(`SELECT source FROM student_documents WHERE file_name='x.pdf' AND doc_type='other'`);
      expect(def[0].source).toBe("documents");
      await expect(ins("chat_attachment", "documents", false)).rejects.toThrow();
      await expect(ins("other", "chat", false)).rejects.toThrow();
      await expect(ins("chat_attachment", "chat", true)).rejects.toThrow();
      await pg.sql(`DELETE FROM student_documents WHERE file_name='x.pdf'`);
    });
    it("widens the bucket for chat types", async () => {
      const r = await rows(`SELECT file_size_limit, allowed_mime_types FROM storage.buckets WHERE id='student-documents'`);
      expect(Number(r[0].file_size_limit)).toBe(20 * 1024 * 1024);
      expect(r[0].allowed_mime_types).toContain(DOCX_MIME);
    });
  });

  describe("HTTP flow", () => {
    it("GET /policy returns the table, limits and quota usage", async () => {
      const r = await request(app).get("/api/student/attachments/policy").set(as(a));
      expect(r.status).toBe(200);
      expect(r.body.maxPerMessage).toBe(5);
      expect(r.body.maxBytesPerMessage).toBe(52_428_800);
      expect(r.body.quotaBytes).toBe(250 * 1024 * 1024);
      expect(r.body.usedBytes).toBe(0);
      expect(r.body.types.find((t: any) => t.ext === "pdf").maxBytes).toBe(20 * 1024 * 1024);
    });

    it("rejects pre-upload: executable, double extension, mime mismatch, oversize", async () => {
      const post = (body: object) => request(app).post("/api/student/attachments/upload-url").set(as(a)).send(body);
      expect((await post({ fileName: "run.exe", sizeBytes: 10, mimeType: "application/octet-stream" })).body.code).toBe("unsupported_type");
      expect((await post({ fileName: "a.exe.pdf", sizeBytes: 10, mimeType: "application/pdf" })).body.code).toBe("invalid_file_name");
      expect((await post({ fileName: "../../x.pdf", sizeBytes: 10, mimeType: "application/pdf" })).body.code).toBe("invalid_file_name");
      expect((await post({ fileName: "a.pdf", sizeBytes: 10, mimeType: "image/png" })).body.code).toBe("mime_mismatch");
      const big = await post({ fileName: "a.txt", sizeBytes: 6 * 1024 * 1024, mimeType: "text/plain" });
      expect(big.status).toBe(413);
      expect(big.body.code).toBe("too_large");
      expect((await post({ fileName: "a.pdf" })).status).toBe(400);
      expect((await post({ fileName: "a.pdf", sizeBytes: 5, mimeType: "application/pdf", ownerId: "x" })).status).toBe(400);
    });

    it("requires a student record and auth identity", async () => {
      const r = await request(app).get("/api/student/attachments/policy").set({ "x-user-id": "not-a-student" });
      expect(r.status).toBe(404);
    });

    it("finalizes a DOCX: creates a chat document row, extracts and indexes text in one go", async () => {
      const docx = buildDocx([{ kind: "h1", text: "Equivalency memo" }, { kind: "p", text: "The student completed calculus at Pathways State." }]);
      const { up, fin } = await attach(a, "Memo équivalence.docx", docx, DOCX_MIME);
      expect(up.body.storagePath).toMatch(new RegExp(`^students/${a.code}/chat_attachment/\\d+_Memo_equivalence\\.docx$`));
      expect(fin.status).toBe(201);
      expect(fin.body.deduplicated).toBe(false);
      const doc = fin.body.document;
      expect(doc).toMatchObject({ fileName: "Memo équivalence.docx", mimeType: DOCX_MIME, sizeBytes: docx.length, docType: "chat_attachment", source: "chat", status: "pending", extractionStatus: "indexed" });
      const [row] = await rows(`SELECT * FROM student_documents WHERE id='${doc.id}'`);
      expect(row).toMatchObject({ source: "chat", doc_type: "chat_attachment", required_for_enrollment: false, verified: false, soft_deleted: false, visibility: "student_staff", student_id: a.id });
      expect(Number(row.size_bytes)).toBe(docx.length);
      expect(row.content_sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(row.url).toContain(up.body.storagePath);
      const chunks = await chunksApi.getDocumentChunks(a.id, doc.id);
      expect(chunks.length).toBe(1);
      expect(chunks[0].content).toContain("calculus at Pathways State");
      expect(chunks[0].location).toBe("paragraphs 1-2");
      const hits = await chunksApi.searchDocumentChunks(a.id, "calculus");
      expect(hits.map((h) => h.documentId)).toEqual([doc.id]);
      // other students never see it
      expect(await chunksApi.searchDocumentChunks(b.id, "calculus")).toEqual([]);
      expect(await chunksApi.getDocumentChunks(b.id, doc.id)).toEqual([]);
    });

    it("finalize is idempotent for the same storagePath", async () => {
      const bytes = buildXlsx([{ name: "Grades", rows: [["Course", "Grade"], ["MATH101", 95]] }]);
      const { up, fin } = await attach(a, "grades.xlsx", bytes, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      expect(fin.status).toBe(201);
      const again = await finalize(a, up.body.storagePath, "grades.xlsx");
      expect(again.status).toBe(200);
      expect(again.body.document.id).toBe(fin.body.document.id);
      expect((await rows(`SELECT 1 FROM student_documents WHERE student_id='${a.id}' AND file_name='grades.xlsx'`))).toHaveLength(1);
    });

    it("de-duplicates identical content: returns the existing document and deletes the redundant object", async () => {
      const bytes = Buffer.from("same bytes in two uploads\n");
      const first = await attach(a, "dup1.txt", bytes, "text/plain");
      expect(first.fin.status).toBe(201);
      const second = await upload(a, "dup2.txt", bytes, "text/plain");
      const fin2 = await finalize(a, second.body.storagePath, "dup2.txt");
      expect(fin2.status).toBe(200);
      expect(fin2.body.deduplicated).toBe(true);
      expect(fin2.body.document.id).toBe(first.fin.body.document.id);
      expect(removed).toContain(second.body.storagePath);
      expect(objects.has(second.body.storagePath)).toBe(false);
      expect(objects.has(first.up.body.storagePath)).toBe(true);
      expect((await rows(`SELECT 1 FROM student_documents WHERE student_id='${a.id}' AND content_sha256 = (SELECT content_sha256 FROM student_documents WHERE id='${first.fin.body.document.id}')`))).toHaveLength(1);
      // The same content for ANOTHER student is a separate document.
      const other = await attach(b, "dup1.txt", bytes, "text/plain");
      expect(other.fin.status).toBe(201);
      expect(other.fin.body.document.id).not.toBe(first.fin.body.document.id);
    });

    it("rejects another student's storagePath (and does not touch their object)", async () => {
      const mine = await upload(b, "bobs.txt", Buffer.from("bob private\n"), "text/plain");
      const r = await finalize(a, mine.body.storagePath, "bobs.txt");
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("invalid_storage_path");
      expect(objects.has(mine.body.storagePath)).toBe(true);
      // Forged paths: traversal, other doc-type folder, other prefix
      for (const p of [`students/${a.code}/chat_attachment/../${b.code}/x.txt`, `students/${a.code}/other/1700000000000_x.txt`, `students/${a.code}/chat_attachment/nope.txt`, "/etc/passwd"]) {
        const f = await finalize(a, p, "x.txt");
        expect([400]).toContain(f.status);
      }
    });

    it("rejects content that does not match: .exe renamed .pdf, PNG named .docx; the object is deleted", async () => {
      const exe = await upload(a, "evil.pdf", EXE_BYTES, "application/pdf");
      const r1 = await finalize(a, exe.body.storagePath, "evil.pdf");
      expect(r1.status).toBe(415);
      expect(r1.body.code).toBe("content_mismatch");
      expect(objects.has(exe.body.storagePath)).toBe(false);
      const png = await upload(a, "pic.docx", PNG_BYTES, DOCX_MIME);
      const r2 = await finalize(a, png.body.storagePath, "pic.docx");
      expect(r2.body.code).toBe("content_mismatch");
      expect(objects.has(png.body.storagePath)).toBe(false);
      expect((await rows(`SELECT 1 FROM student_documents WHERE file_name IN ('evil.pdf','pic.docx')`))).toHaveLength(0);
    });

    it("rejects an encrypted PDF and a name that differs from the stored object's extension", async () => {
      const enc = await upload(a, "locked.pdf", buildPdf([["secret"]], { encrypted: true }), "application/pdf");
      const r = await finalize(a, enc.body.storagePath, "locked.pdf");
      expect(r.body.code).toBe("encrypted");
      const ok = await upload(a, "fine.txt", Buffer.from("fine\n"), "text/plain");
      const mismatch = await finalize(a, ok.body.storagePath, "fine.pdf");
      expect(mismatch.status).toBe(400);
    });

    it("trusts the real stored size, not the declared one (oversize swap is rejected and deleted)", async () => {
      const up = await request(app).post("/api/student/attachments/upload-url").set(as(a)).send({ fileName: "small.txt", sizeBytes: 10, mimeType: "text/plain" });
      objects.set(up.body.storagePath, Buffer.alloc(5 * 1024 * 1024 + 1, 0x61));
      const r = await finalize(a, up.body.storagePath, "small.txt");
      expect(r.status).toBe(413);
      expect(objects.has(up.body.storagePath)).toBe(false);
    });

    it("reports not_uploaded when nothing was stored", async () => {
      const up = await request(app).post("/api/student/attachments/upload-url").set(as(a)).send({ fileName: "ghost.txt", sizeBytes: 10, mimeType: "text/plain" });
      const r = await finalize(a, up.body.storagePath, "ghost.txt");
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("not_uploaded");
    });

    it("scanned/image attachments are stored_only and still previewable via the document row", async () => {
      const { fin } = await attach(a, "scan.png", PNG_BYTES, "image/png");
      expect(fin.status).toBe(201);
      expect(fin.body.document.extractionStatus).toBe("stored_only");
      expect(await chunksApi.getDocumentChunks(a.id, fin.body.document.id)).toEqual([]);
    });

    it("lists both sources for the owner only", async () => {
      await pg.sql(`INSERT INTO student_documents (student_id, doc_type, file_name, url, storage_path) VALUES ('${a.id}', 'hs_transcript', 'transcript.pdf', 'u', 'students/${a.code}/hs_transcript/1700000000000_transcript.pdf')`);
      await pg.sql(`INSERT INTO student_documents (student_id, doc_type, file_name, url, storage_path, visibility) VALUES ('${a.id}', 'other', 'staffonly.pdf', 'u', 'students/${a.code}/other/1700000000001_staffonly.pdf', 'staff_only')`);
      const r = await request(app).get("/api/student/attachments/documents").set(as(a));
      expect(r.status).toBe(200);
      const names = r.body.documents.map((d: any) => d.fileName);
      expect(names).toContain("transcript.pdf");
      expect(names).toContain("Memo équivalence.docx");
      expect(names).not.toContain("staffonly.pdf");
      expect(r.body.documents.find((d: any) => d.fileName === "transcript.pdf")).toMatchObject({ source: "documents", docType: "hs_transcript", extractionStatus: null, mimeType: "application/pdf", sizeBytes: 0 });
      const rb = await request(app).get("/api/student/attachments/documents").set(as(b));
      expect(rb.body.documents.map((d: any) => d.fileName)).not.toContain("transcript.pdf");
    });
  });

  describe("quota", () => {
    it("enforces the per-student override at upload-url and at finalize, and counts only non-deleted documents", async () => {
      const user = await seedUser(pg, "student", "q");
      const st = await seedStudent(pg, { userId: user.id });
      users.set(user.id, { id: st.id, student_code: st.code });
      const q = { userId: user.id, id: st.id, code: st.code };
      await pg.sql(`INSERT INTO student_storage_quota (student_id, quota_bytes, updated_by) VALUES ('${q.id}', 100, 'staff')`);

      const pol = await request(app).get("/api/student/attachments/policy").set(as(q));
      expect(pol.body.quotaBytes).toBe(100);

      const first = await attach(q, "one.txt", Buffer.from("x".repeat(60)), "text/plain");
      expect(first.fin.status).toBe(201);
      // pre-check at upload-url
      const pre = await request(app).post("/api/student/attachments/upload-url").set(as(q)).send({ fileName: "two.txt", sizeBytes: 60, mimeType: "text/plain" });
      expect(pre.status).toBe(413);
      expect(pre.body.code).toBe("quota_exceeded");
      // finalize re-check (object swapped after a successful pre-check)
      const small = await request(app).post("/api/student/attachments/upload-url").set(as(q)).send({ fileName: "three.txt", sizeBytes: 10, mimeType: "text/plain" });
      expect(small.status).toBe(200);
      objects.set(small.body.storagePath, Buffer.from("y".repeat(60)));
      const fin = await finalize(q, small.body.storagePath, "three.txt");
      expect(fin.status).toBe(413);
      expect(fin.body.code).toBe("quota_exceeded");
      expect(objects.has(small.body.storagePath)).toBe(false);

      // Deleting frees the space
      await pg.sql(`UPDATE student_documents SET soft_deleted = true WHERE id='${first.fin.body.document.id}'`);
      const after = await attach(q, "four.txt", Buffer.from("z".repeat(60)), "text/plain");
      expect(after.fin.status).toBe(201);
    });

    it("concurrent finalizes cannot jointly exceed the quota", async () => {
      const user = await seedUser(pg, "student", "race");
      const st = await seedStudent(pg, { userId: user.id });
      users.set(user.id, { id: st.id, student_code: st.code });
      const q = { userId: user.id, id: st.id, code: st.code };
      await pg.sql(`INSERT INTO student_storage_quota (student_id, quota_bytes) VALUES ('${q.id}', 150)`);
      const ups = await Promise.all(["a", "b", "c", "d"].map((n) => upload(q, `${n}.txt`, Buffer.from(n.repeat(100)), "text/plain")));
      expect(ups.every((u) => u.status === 200)).toBe(true);
      const results = await Promise.all(ups.map((u, i) => finalize(q, u.body.storagePath, `${"abcd"[i]}.txt`)));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 413)).toHaveLength(3);
      const [sum] = await rows(`SELECT COALESCE(SUM(size_bytes),0)::int AS s FROM student_documents WHERE student_id='${q.id}' AND soft_deleted=false`);
      expect(sum.s).toBeLessThanOrEqual(150);
    });
  });

  describe("index invalidation", () => {
    it("removes chunks and marks stored_only when the document is deleted; cascade on hard delete", async () => {
      const { fin } = await attach(a, "to-delete.txt", Buffer.from("remove me from the index\n"), "text/plain");
      const id = fin.body.document.id;
      expect((await rows(`SELECT 1 FROM student_document_text WHERE document_id='${id}'`)).length).toBeGreaterThan(0);
      await pg.sql(`UPDATE student_documents SET soft_deleted=true WHERE id='${id}'`);
      // retrieval never serves soft-deleted documents even before cleanup
      expect(await chunksApi.searchDocumentChunks(a.id, "remove")).toEqual([]);
      await invalidate(id);
      expect(await rows(`SELECT 1 FROM student_document_text WHERE document_id='${id}'`)).toHaveLength(0);
      expect((await rows(`SELECT extraction_status FROM student_documents WHERE id='${id}'`))[0].extraction_status).toBe("stored_only");

      const second = await attach(a, "to-hard-delete.txt", Buffer.from("cascade me away\n"), "text/plain");
      const id2 = second.fin.body.document.id;
      await pg.sql(`DELETE FROM student_documents WHERE id='${id2}'`);
      expect(await rows(`SELECT 1 FROM student_document_text WHERE document_id='${id2}'`)).toHaveLength(0);
    });
  });
});
