---
name: Admin AI safety boundary
description: Safety requirements for staff-facing AI grounded in student records.
---

Admin-facing contextual AI must be separate from the student assistant and may only answer from scoped, authorized, read-only server data. If the provider or grounding tools are unavailable, show an unavailable state rather than FAQ text or invented answers.

**Why:** The owner requested real student-context answers with least-privilege access and explicitly rejected fake answers or student-session privileges.

**How to apply:** Keep the entry admin-only. Before enabling answers, configure a server-side provider and audited tools that enforce the admin role and selected-student scope for every read; do not add write tools.
