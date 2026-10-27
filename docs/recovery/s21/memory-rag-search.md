# S21: assistant memory, private retrieval, global search, knowledge base

## Design
- **Memory** (`server/services/assistant-memory/`): deterministic EN/FR pattern extraction (`extract.ts`, no model) of what the
  student states: intended major, education goal, preferred language, country/institution interest, pathway, priority, schedule,
  study preference, open question. Basis is always `student_reported`; `approved_plan`/`official_record` are never produced from chat.
  Messages that trip the existing PII guard, questions and conditionals yield nothing.
- Persistence (`store.ts`) touches only `student_assistant_memory` and `assistant_memory_sources` (asserted by `tests/s21-memory-isolation.test.ts`).
  Same fact again = extra source, no new row. Single-valued categories (major, education goal, language) supersede the previous active
  value (both kept, linked by `supersedes_id`/`superseded_by_id`, `version`+1). Correction = new version with `student_correction` source.
  Retraction keeps the row. Idempotent per message id; advisory lock per owner.
- **Private retrieval** (`private-retrieval.ts`): owner-only; memory (active), past messages (`assistant_messages.search_vector`,
  `websearch_to_tsquery('simple')` with OR of raw+folded words, `ts_rank`, recency), document chunks (`student_document_text` joined to
  `student_documents`/`students` where `students.user_id = owner`, not soft-deleted, `visibility <> 'staff_only'`), and academic context via the
  existing roadmap/high-school read services (no credit maths). Relevance threshold (token coverage >= 0.34 plus one informative token),
  duplicate suppression, exact course-code and institution boost. Never sent to a model provider.
- **Global search** (`global-search/`, `routes/search.ts`): student scope = own courses/subjects, roadmap, documents (name, type, indexed text),
  tickets (subject), conversations (title + text), memory, billing page. Staff/admin = students only. Coach/other = nothing.
- **Knowledge base**: 17 original entries + 33 new, each external fact with an https source verified 2026-10-27 and "receiving institution decides" limits.
  `retrieval.ts` adds institution matching, source-date demotion (>18 months), near-duplicate suppression.

## Sources table
| Source | kind | route / path |
|---|---|---|
| `student_assistant_memory` | memory | `/assistant?memory=<id>` |
| `assistant_messages` | message | `/assistant?conversation=<id>` |
| `student_document_text` | document ("Found in your document") | `/documents` |
| roadmap view | academic | `/roadmap` |
| high-school view | academic | `/high-school` |
| `support_tickets` | ticket (search only) | `/support` |
| billing keywords | billing (search only, page only) | `/billing` |
| students (staff/admin) | student | `/admin/students/<id>` |

## Limits
- Extraction is pattern based: it misses unusual phrasing and is deliberately conservative (e.g. "my credits" trips the PII guard).
- Accent folding in retrieval is applied to the query; a plain-ASCII query will not match accented words stored in a `simple` tsvector
  (an accented query does match unaccented text).
- Search returns the billing page only, not amounts or receipts. Support deep link is `/support` (no ticket route exists).
- Academic context comes from the published roadmap and high-school plan; if neither exists nothing is returned from it.
- Knowledge facts reflect public pages on 2026-10-27 and can go stale; entries carry `verifiedAt`.
