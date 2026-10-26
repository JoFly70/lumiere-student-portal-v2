# S10 - Staff caseload scoping: finding

## Question

S07 lets any user with role `staff` or `admin` prepare roadmap drafts (`server/routes/admin-student-roadmap.ts`: `staffOrAdmin = requireRole(["staff","admin"])`; publish and some other actions are `adminOnly`). Is there an authoritative student-to-staff relationship the roadmap routes could use to scope that access safely?

## What exists

| Candidate | Where | Authoritative? |
|---|---|---|
| `coach_assignments (coach_id -> users.id, student_id -> users.id, unique pair)` | `shared/schema.ts:436`, legacy `migrations/001_initial_schema.sql:188`, created by `server/complete-missing-tables.ts` | **No.** Absent from `PRODUCTION_DATABASE_SETUP.sql`, from the whole `supabase/migrations` chain and from the disposable environment. No server code reads or writes it (only the table-creation script references it). Designed for role `coach`, not `staff`. No admin UI to maintain it. |
| `requireCoachStudent` | `server/middleware/rbac.ts:149` | It denies coaches by default and says so in code: "Without a reliable coach-assignment table, deny by default". Not mounted for roadmap routes. |
| `support_tickets.assigned_to` | production lineage | Per-ticket assignee, not a caseload: it says who handles one ticket, not who may edit a student's roadmap or academic data. A student with no ticket has no assignee. Not suitable. |
| `enrollments.assigned_by` / `source = 'advisor'` | `shared/schema.ts` | Records who put a course on a student's enrolment; historical authorship, not entitlement. |
| `profiles`, `students`, `users` | production lineage | No advisor/owner/coach column. `students.user_id` links a student to their own login only. |
| Roadmap tables (`student_roadmap_*`) | S05 migration | Track authorship of versions (who drafted/published), not who is entitled to. |

## Conclusion

There is **no authoritative, populated, maintained staff-to-student assignment** in the schema the portal runs on. The only table that looks like one is unused, absent from the production lineage, keyed for coaches (a role the roadmap and academic routes deliberately exclude), and has no owner-confirmed data. Scoping staff by it would either (a) lock every staff user out because the table is empty or missing, or (b) require inventing assignments. Both are explicitly out of bounds, so **nothing was implemented** and no access was removed.

## Status: blocks production readiness (governance)

Today any staff user can read and edit any student's roadmap draft, reach per-student admin-visible data exposed to `staff`, and (for the endpoints open to `staff`) prepare content for students they have no relationship with. In a supervised pilot with a small, trusted staff this is a known, accepted-or-not business risk; for production it needs an owner decision.

## Decisions the owner must make

1. Is caseload scoping required for `staff`, or is "all staff see all students" the intended policy (then document it and close the finding)?
2. If scoping is required: which table is authoritative. Smallest mechanism once decided: one table `student_staff_assignments(student_id text references students(id), staff_user_id text references users(id), active boolean, assigned_by, assigned_at)` (or reuse `coach_assignments` after adding it to the migration chain and extending it to role `staff`), maintained by admins only, plus one shared helper `staffMayAccessStudent(user, studentId)` called by the roadmap/academic staff routes and covered by a deny-by-default test (empty table means staff are denied, admins unaffected).
3. Who populates the initial assignments, and what happens to unassigned students (admin-only until assigned is the safe default).
4. Whether `coach` should gain roadmap access through the same table (currently 403 by design).

## Not done / not verified

No migration, helper or route change was made for this item. No production data was read to see whether `coach_assignments` exists or holds rows; that is the first thing to check (`select to_regclass('public.coach_assignments')`, then a row count) before the decision above.
