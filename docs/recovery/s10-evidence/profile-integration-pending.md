# Profile integration: PENDING (S09 not accepted)

S10 does not touch student-profile code. `/profile` exists in this branch from earlier work and only its navigation state is rendered (`screens/20-profile-nav-1440-light.png`, `21-profile-nav-menu-390-light.png`). It is NOT accepted here: axe reports one moderate `heading-order` on it, and none of the items below has been verified in the consolidated journey.

What the consolidated journey needs from S09 before profile can join it. Every item is unchecked.

- [ ] **Own-profile access.** A student reads only their own profile (`/api/students/me`); another student's id gives 404, not 403 with data. Journey step: second student cannot read the first student's profile.
- [ ] **Contact updates.** Phone, email-preference and address edits succeed for the owner, validate input, write an audit row, and never change canonical credit/degree tables (assert the same md5 snapshot as step A7).
- [ ] **Secure photo.** Upload goes to a private path under the student's own prefix, type/size allow-list, signed URL with short expiry, no public URL, another student or role cannot fetch it. Same ownership rules as the support attachments (`tickets/<id>/<uploader>/...`).
- [ ] **Identity corrections.** Legal name, date of birth and ID details are requests, not direct edits: a student submits a correction (ideally as a support ticket topic with the same 404 isolation and internal-note rules), staff approves, and an audit row records old and new values.
- [ ] **Guardian / contact authorization.** Adding, removing and authorizing contacts is owner-only, consent state is explicit, and a guardian contact never gains access to the student's record, roadmap or tickets.
- [ ] **Academic history display.** Profile shows prior credentials from the canonical record read-only (the same figures as the Flight Deck foundation: reported vs verified vs applied), with no edit controls.
- [ ] **Protected fields.** Student code, status, role, program assignment, credit and verification fields are rejected on student writes (400, as the roadmap progress endpoint does for credit/degree/studentId fields) and the canonical tables stay byte-identical.
- [ ] **Navigation and shell.** One profile entry in the shell (nav items are owned by another session in S10) with the active state correct on `/profile` at 1440 and 390; heading order fixed (currently `h3` directly under the page title).
- [ ] **Evidence.** A profile step in `tests/s10-consolidated-journey.test.ts` (real Postgres) plus axe and 390px overflow screens, added only after S09 is accepted and merged.
