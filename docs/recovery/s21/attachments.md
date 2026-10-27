# S21 chat attachments (B)

Students attach files to Lumière Guide messages by reusing the Documents system: same private bucket
`student-documents`, same `student_documents` rows (`source = 'chat'`, `doc_type = 'chat_attachment'`),
same signed-URL download route (`GET /api/documents/:id`), same staff tooling. Nothing new is public.

## API (mount `/api/student/attachments`, bearer auth, mutating routes `requireCsrf`)
`GET /policy`, `POST /upload-url`, `POST /finalize`, `GET /documents` as in `api-contracts.md`.
Finalize returns `201 { document, deduplicated:false }`, or `200 { document, deduplicated:true }` when the same
student already holds identical content (same SHA-256) or retries the same `storagePath`.
Errors: `{ error, code }` with `invalid_request` 400, `invalid_file_name` 400, `invalid_storage_path` 400,
`not_uploaded` 400, `empty_file` 400, `unsupported_type`/`mime_mismatch`/`content_mismatch`/`encrypted`/`malformed`/`zip_bomb` 415,
`too_large`/`quota_exceeded` 413, `not_found` 404 (no student record), `throttled` 429, `storage_unavailable` 503.

## Formats and limits (`server/lib/attachment-policy.ts`)
| Type | Max | Real-content check |
|---|---|---|
| PDF | 20 MB | `%PDF-` header; `/Encrypt` rejected |
| DOCX, XLSX | 20 MB | valid ZIP with `[Content_Types].xml` and `word/document.xml` or `xl/workbook.xml`; no macros; OLE/encrypted rejected |
| CSV | 10 MB | UTF-8, no NUL / binary control characters |
| TXT | 5 MB | same |
| JPG/JPEG, PNG, WEBP | 10 MB | JPEG `FFD8FF`, PNG signature, `RIFF....WEBP` |

Per message: 5 files and 50 MB combined (enforced by the conversations API, constants exported here).
Quota per student: default 250 MB (`STUDENT_STORAGE_QUOTA_MB`), override row in `student_storage_quota`.
Usage = sum of `size_bytes` of the student's non-deleted `student_documents` rows (legacy Documents-page rows have no
size and count as 0). Quota and de-duplication are decided inside one transaction under a per-student advisory lock.
The Documents page keeps its own stricter `validateFile` (10 MB, PDF/images); it is unchanged.

File names: 1 to 200 characters; path separators, `..`, control and bidi characters, leading dot, trailing dot,
double extensions (`invoice.exe.pdf`, `photo.png.jpg`) and executables are rejected. The storage key is an ASCII
rendering; the display name is kept on the row. The declared MIME must agree with the extension, but the stored MIME
always comes from the sniffed type, never from the client.

## Finalize pipeline
1. `storagePath` must be `students/{this student's code}/chat_attachment/{ts}_{name}` (`isStoragePathForStudent`).
2. Object must exist; its size is read from storage metadata before downloading (bounded to the per-type cap).
3. Sniff + size + encryption + bomb checks on the real bytes; on any rejection the uploaded object is deleted.
4. SHA-256; duplicate (same student, non-deleted) returns the existing document and deletes the redundant object.
5. Bounded extraction, then one transaction inserts the row and its chunks. Extraction never rejects an upload.

## Extraction (`server/services/document-extraction/*`)
Local, dependency-free, synchronous. Chunks are about 1,500 characters with a location label:
`paragraphs 10-20` (DOCX), `Sheet1 rows 1-40` (XLSX), `rows 1-50` (CSV), `lines 1-30` (TXT), `page 3` (PDF).
Caps: 200,000 characters and 400 chunks per document, 8 s wall clock, CSV 5,000 rows x 50 columns, XLSX 20 sheets x 5,000 rows
x 50 columns (hidden sheets skipped), PDF 300 pages. `extraction_status`: `indexed`, `stored_only` (images, scanned or
unreadable PDFs, no text), `failed` (valid container but parsing failed). NUL and control characters are stripped.

## Zip safety (`zip-reader.ts`)
Own reader on `zlib.inflateRawSync` with `maxOutputLength` equal to the declared entry size (a lying header throws instead of
allocating). Caps: 1,000 entries, 24 MB per entry, 120 MB declared total, 64 MB actually inflated, compression ratio 200:1
(entry and archive). Rejects encrypted entries, ZIP64, multi-disk, unsupported methods, duplicate names and unsafe names.
Nothing is ever extracted to disk.

## Threat model (what is covered)
Renamed executables and polyglots (extension vs. sniffed type), path traversal in names and storage paths, other students'
objects (path prefix + owner from `req.user.id`, never from the client), decompression bombs, oversized objects swapped after
the pre-check (real size re-read), quota races (advisory lock), encrypted files, macro-enabled Office packages renamed, NUL
injection into Postgres text, stale text of deleted documents (chunks removed on delete; retrieval also joins
`soft_deleted = false`). A `CHECK` constraint makes `chat_attachment` rows possible only with `source = 'chat'` and never
`required_for_enrollment`, so the generic Documents upload cannot create them and they never count toward enrollment.

## Not supported
OCR (images are stored and previewable only), scanned or image-only PDFs, PDFs using CID/Type0 fonts without readable
strings (no ToUnicode CMaps), PDF filters other than Flate (LZW, ASCII85, JBIG2...), encrypted PDFs, legacy `.doc/.xls`,
macro-enabled files, headers/footers/footnotes/text boxes in DOCX, formula results/dates formatting in XLSX (raw cached values),
virus scanning (no scanner is configured; files are never executed or rendered server-side), orphan cleanup of uploads that
are never finalized.

## Reading chunks (for retrieval)
`server/services/chat-attachments/chunks.ts`: `getDocumentChunks(studentId, documentId, limit)` and
`searchDocumentChunks(studentId, query, limit, onlyDocumentIds?)` (always owner-scoped and `soft_deleted = false`).
Table: `student_document_text(document_id text, student_id text, ...)`; ids are `text` because `student_documents.id` is text.
