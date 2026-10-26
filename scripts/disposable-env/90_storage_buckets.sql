-- DISPOSABLE ENVIRONMENT ONLY — private Storage buckets the server expects.
-- No SQL in the repository creates them; limits mirror the code:
--   student-documents: server/lib/document-storage.ts:9-18 (10 MB, pdf/png/jpeg/jpg/webp)
--   documents:         server/routes/tickets.ts:606 (ticket attachments, 10 MB)
--   knowledge-evidence: server/lib/knowledge-storage.ts (PDF only, 10 MB)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types) VALUES
  ('student-documents', 'student-documents', false, 10485760,
     ARRAY['application/pdf','image/png','image/jpeg','image/jpg','image/webp']),
  ('documents', 'documents', false, 10485760, NULL),
  ('knowledge-evidence', 'knowledge-evidence', false, 10485760, ARRAY['application/pdf'])
ON CONFLICT (id) DO NOTHING;
