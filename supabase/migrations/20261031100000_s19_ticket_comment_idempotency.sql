-- S19: reply idempotency for support ticket comments.
-- A client-generated Idempotency-Key makes a retried reply return the existing comment instead of
-- inserting a duplicate. Additive and idempotent; not applied automatically. The route works
-- WITHOUT this migration (it detects the missing column and skips deduplication).
-- Guarded with to_regclass (the disposable migration harness may not create ticket_comments).
DO $$
BEGIN
  IF to_regclass('public.ticket_comments') IS NOT NULL THEN
    ALTER TABLE public.ticket_comments
      ADD COLUMN IF NOT EXISTS idempotency_key text;

    CREATE UNIQUE INDEX IF NOT EXISTS ticket_comments_author_idempotency_key_uniq
      ON public.ticket_comments (ticket_id, author_id, idempotency_key)
      WHERE idempotency_key IS NOT NULL;
  END IF;
END
$$;
