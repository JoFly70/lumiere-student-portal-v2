/**
 * Staff entry to student billing (S20/S26/S32-B): /staff/billing, staff + admin.
 * Staff cannot open the admin-only student workspace, so this is their way in. The start list is built from the
 * directory facts (every student, not just the newest): overdue accounts first, then students whose proof of
 * payment is waiting for review, then the most recent. Search covers all students by name, email or code, and a
 * student ID can still be pasted as a fallback. It grants nothing; the billing API enforces the role on every call.
 */
import React from "react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ChevronRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { factsById, formatMoney, useDirectoryFacts, type DirectoryFacts } from "@/components/admin/directory/directory-data";
import { StaffAvatar, StaffPill, StaffCard, StaffEmpty, StaffNotice, StaffPage, StaffPageHeader, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";
import { useT } from "@/i18n";

void React;

export const staffStudentBillingHref = (studentId: string) => `/admin/students/${encodeURIComponent(studentId.trim())}/billing`;

interface StudentRow { id: string; first_name: string; last_name: string; preferred_name?: string | null; student_code?: string | null; status: string; email?: string | null; created_at?: string | null }

export interface BillingStartRow {
  readonly id: string;
  readonly name: string;
  readonly code: string;
  readonly overdue: boolean;
  /** Proofs of payment waiting for staff review. */
  readonly awaitingEvidence: number;
  readonly balance: { readonly balanceCents: number; readonly currency: string } | null;
}

/** How many rows the start list shows at least; every overdue or awaiting-proof student is shown beyond that. */
export const START_LIST_MIN = 12;

/**
 * Overdue first (largest balance first), then proof waiting for review, then the most recent students until the list
 * has at least START_LIST_MIN rows. Pure: students without facts simply rank as "recent".
 */
export function buildBillingStartList(
  students: readonly StudentRow[],
  facts: ReadonlyMap<string, DirectoryFacts>,
  awaiting: ReadonlyMap<string, number>,
  min = START_LIST_MIN,
): BillingStartRow[] {
  const rank = (s: StudentRow) => (facts.get(s.id)?.billing?.overdue ? 0 : (awaiting.get(s.id) ?? 0) > 0 ? 1 : 2);
  const recent = (s: StudentRow) => s.created_at ?? "";
  const ordered = [...students].sort((a, b) => {
    const ra = rank(a), rb = rank(b);
    if (ra !== rb) return ra - rb;
    if (ra === 0) return (facts.get(b.id)?.billing?.balanceCents ?? 0) - (facts.get(a.id)?.billing?.balanceCents ?? 0);
    return recent(b).localeCompare(recent(a));
  });
  const priority = ordered.filter((s) => rank(s) < 2).length;
  return ordered.slice(0, Math.max(priority, min)).map((s) => {
    const b = facts.get(s.id)?.billing ?? null;
    return {
      id: s.id,
      name: `${s.preferred_name || s.first_name} ${s.last_name}`.trim(),
      code: s.student_code ?? s.email ?? "",
      overdue: !!b?.overdue,
      awaitingEvidence: awaiting.get(s.id) ?? 0,
      balance: b ? { balanceCents: b.balanceCents, currency: b.currency } : null,
    };
  });
}

export function BillingStartList({ rows }: { rows: readonly BillingStartRow[] }) {
  const { t } = useT();
  return (
    <div data-testid="billing-start-list">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{t("s32.billing.lookup.startTitle")}</p>
      <ul className="divide-y divide-student-line">
        {rows.map((r) => (
          <li key={r.id} data-testid="billing-start-row" data-overdue={r.overdue ? "true" : "false"}>
            <Link href={staffStudentBillingHref(r.id)} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-student-gold-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink">
              <span className="flex min-w-0 items-center gap-3"><StaffAvatar name={r.name} size="sm" /><span className="min-w-0"><span className="block truncate font-medium text-student-ink">{r.name}</span><span className="block truncate text-xs text-student-muted">{r.code}</span></span></span>
              <span className="flex shrink-0 flex-wrap items-center justify-end gap-2 text-sm">
                {r.overdue ? <StaffPill tone="attention">{t("s32.billing.lookup.overdue")}</StaffPill> : null}
                {r.awaitingEvidence > 0 ? <StaffPill tone="gold">{t("s32.billing.lookup.proofWaiting")}</StaffPill> : null}
                {r.balance === null ? <span className="text-xs text-student-muted">{t("s32.billing.lookup.noPrice")}</span>
                  : r.balance.balanceCents > 0 ? <span className="tabular-nums text-student-muted" data-testid="billing-start-balance">{t("s32.billing.lookup.owes", { amount: formatMoney(r.balance.balanceCents, r.balance.currency) })}</span>
                  : <span className="text-xs text-student-muted">{t("s32.billing.lookup.settled")}</span>}
                <ArrowRight className="h-4 w-4 text-student-gold-ink" aria-hidden="true" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-student-muted">{t("s32.billing.lookup.orSearch")}</p>
    </div>
  );
}

export default function StaffBillingLookup() {
  const { t } = useT();
  const [, navigate] = useLocation();
  const [term, setTerm] = useState("");
  const [studentId, setStudentId] = useState("");
  const q = term.trim();
  const students = useQuery<{ students: StudentRow[]; total: number }>({
    queryKey: ["/api/students", "billing-lookup", q],
    queryFn: () => api.get(`/api/students?limit=20${q ? `&search=${encodeURIComponent(q)}` : ""}`),
    enabled: q.length >= 2,
    retry: false,
  });
  // Start state: every student, ranked by what needs attention. The directory facts and the awaiting-proof list are
  // best effort: without them the list still loads, ordered by recency.
  const all = useQuery<{ students: StudentRow[]; total: number }>({
    queryKey: ["/api/students", "billing-lookup", "all"],
    queryFn: () => api.get("/api/students?limit=1000"),
    enabled: q.length < 2,
    retry: false,
  });
  const awaitingQuery = useQuery<{ students: Array<{ studentId: string; count: number }> }>({
    queryKey: ["/api/admin/billing/awaiting-evidence"],
    queryFn: () => api.get("/api/admin/billing/awaiting-evidence"),
    enabled: q.length < 2,
    retry: false,
  });
  const facts = factsById(useDirectoryFacts().data?.facts);
  const awaiting = new Map((awaitingQuery.data?.students ?? []).map((a) => [a.studentId, a.count] as const));
  const startRows = buildBillingStartList(all.data?.students ?? [], facts, awaiting);
  const valid = studentId.trim().length > 0 && studentId.trim().length <= 128;
  const rows = students.data?.students ?? [];
  return (
    <StaffPage testId="staff-billing-lookup">
      <StaffPageHeader eyebrow={t("s32.billing.lookup.eyebrow")} title={t("s32.billing.lookup.title")} description={t("s32.billing.lookup.desc")} />
      <StaffCard className="space-y-3">
        <label className={staffLabel} htmlFor="staff-billing-search">{t("s32.billing.lookup.find")}</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
          <input id="staff-billing-search" className={`${staffField} pl-8`} placeholder={t("s32.billing.lookup.placeholder")} value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" data-testid="input-billing-search" />
        </div>
        {q.length < 2 ? (
          all.isLoading ? <p role="status" className="text-sm text-student-muted">{t("s32.billing.lookup.loading")}</p>
          : startRows.length === 0 ? <p className="text-sm text-student-muted">{t("s32.billing.lookup.typeTwo")}</p>
          : <BillingStartList rows={startRows} />
        )
          : students.isLoading ? <p role="status" className="text-sm text-student-muted">{t("s32.billing.lookup.searching")}</p>
          : students.isError ? <StaffNotice tone="urgent" role="alert">{t("s32.billing.lookup.error")}</StaffNotice>
          : rows.length === 0 ? <StaffEmpty title={t("s32.billing.lookup.noMatch")}>{t("s32.billing.lookup.tryAnother")}</StaffEmpty>
          : (
            <ul className="divide-y divide-student-line" data-testid="billing-student-results">
              {rows.map((st) => {
                const name = `${st.preferred_name || st.first_name} ${st.last_name}`;
                return (
                  <li key={st.id}>
                    <Link href={staffStudentBillingHref(st.id)} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-student-gold-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="billing-student-open">
                      <span className="flex min-w-0 items-center gap-3"><StaffAvatar name={name} size="sm" /><span className="min-w-0"><span className="block truncate font-medium text-student-ink">{name}</span><span className="block truncate text-xs text-student-muted">{st.student_code ?? t("s32.billing.lookup.noCode")} · {st.status}</span></span></span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-student-gold-ink">{t("s32.billing.lookup.open")}<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </StaffCard>
      <details className="group rounded-xl border border-student-line bg-student-card px-4 py-3 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-student-ink [&::-webkit-details-marker]:hidden"><ChevronRight className="h-4 w-4 text-student-muted transition-transform group-open:rotate-90" aria-hidden="true" />{t("s32.billing.lookup.byId")}</summary>
        <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (valid) navigate(staffStudentBillingHref(studentId)); }}>
          <div className="min-w-0 flex-1">
            <label className={staffLabel} htmlFor="staff-billing-student-id">{t("s32.billing.lookup.idLabel")}</label>
            <input id="staff-billing-student-id" className={`${staffField} mt-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="off" spellCheck={false} data-testid="input-billing-student-id" />
          </div>
          <button type="submit" className={staffBtn.primary} disabled={!valid} data-testid="button-open-student-billing">{t("s32.billing.lookup.openBilling")}</button>
        </form>
      </details>
    </StaffPage>
  );
}
