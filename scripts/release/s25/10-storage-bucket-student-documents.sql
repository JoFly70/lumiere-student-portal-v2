-- S25 PRODUCTION: student-documents bucket must match what the deployed code accepts
-- (server/lib/attachment-policy.ts ATTACHMENT_TYPES: max 20 MiB, pdf/docx/xlsx/csv/txt/jpg/jpeg/png/webp).
-- This is the same UPDATE that 20261102110000_s21_document_attachments.sql step 6 performs; run this file on
-- its own only if that migration is skipped or the bucket was edited by hand. Idempotent; bucket stays PRIVATE.
-- Documents page uploads stay capped at 10 MB / PDF+images by validateFile in server/lib/document-storage.ts.
UPDATE storage.buckets
   SET public = false,
       file_size_limit = 20971520,
       allowed_mime_types = ARRAY[
         'application/pdf','image/png','image/jpeg','image/jpg','image/webp',
         'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
         'text/csv','application/csv','application/vnd.ms-excel','text/plain'
       ]
 WHERE id = 'student-documents';
SELECT id, public, file_size_limit, allowed_mime_types FROM storage.buckets WHERE id = 'student-documents';
