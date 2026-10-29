/**
 * Staff entry to student billing (S20/S26): /staff/billing, staff + admin.
 * Staff cannot open the admin-only student workspace, so this is their way in: search a student by
 * name, email or student code and open their billing. A student ID can still be pasted as a fallback.
 * It grants nothing; the billing API enforces the role on every call.
 */
import React from "react";
import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { StaffAvatar, StaffCard, StaffEmpty, StaffNotice, StaffPage, StaffPageHeader, staffBtn, staffField, staffLabel } from "@/components/staff/staff-ui";

void React;

export const staffStudentBillingHref = (studentId: string) => `/admin/students/${encodeURIComponent(studentId.trim())}/billing`;

interface StudentRow { id: string; first_name: string; last_name: string; preferred_name?: string | null; student_code?: string | null; status: string; email?: string | null }

export default function StaffBillingLookup() {
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
  const valid = studentId.trim().length > 0 && studentId.trim().length <= 128;
  const rows = students.data?.students ?? [];
  return (
    <StaffPage testId="staff-billing-lookup">
      <StaffPageHeader eyebrow="Billing" title="Student billing" description="Find a student, then open their billing: agreed price, adjustments, schedule, payments and proof of payment." />
      <StaffCard className="space-y-3">
        <label className={staffLabel} htmlFor="staff-billing-search">Find a student</label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
          <input id="staff-billing-search" className={`${staffField} pl-8`} placeholder="Name, email or student code" value={term} onChange={(e) => setTerm(e.target.value)} autoComplete="off" data-testid="input-billing-search" />
        </div>
        {q.length < 2 ? <p className="text-sm text-student-muted">Type at least two characters.</p>
          : students.isLoading ? <p role="status" className="text-sm text-student-muted">Searching…</p>
          : students.isError ? <StaffNotice tone="urgent" role="alert">Students could not be loaded. Try again, or open billing by student ID below.</StaffNotice>
          : rows.length === 0 ? <StaffEmpty title="No student matches">Try another name or code.</StaffEmpty>
          : (
            <ul className="divide-y divide-student-line" data-testid="billing-student-results">
              {rows.map((st) => {
                const name = `${st.preferred_name || st.first_name} ${st.last_name}`;
                return (
                  <li key={st.id}>
                    <Link href={staffStudentBillingHref(st.id)} className="flex min-h-14 items-center justify-between gap-3 py-2 hover:bg-student-gold-soft/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink" data-testid="billing-student-open">
                      <span className="flex min-w-0 items-center gap-3"><StaffAvatar name={name} size="sm" /><span className="min-w-0"><span className="block truncate font-medium text-student-ink">{name}</span><span className="block truncate text-xs text-student-muted">{st.student_code ?? "No code"} · {st.status}</span></span></span>
                      <span className="inline-flex shrink-0 items-center gap-1 text-sm font-semibold text-student-gold-ink">Open billing<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
      </StaffCard>
      <details className="rounded-xl border border-student-line bg-student-card px-4 py-3 text-sm">
        <summary className="cursor-pointer font-medium text-student-ink">Open by student ID instead</summary>
        <form className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end" onSubmit={(e) => { e.preventDefault(); if (valid) navigate(staffStudentBillingHref(studentId)); }}>
          <div className="min-w-0 flex-1">
            <label className={staffLabel} htmlFor="staff-billing-student-id">Student ID</label>
            <input id="staff-billing-student-id" className={`${staffField} mt-1`} value={studentId} onChange={(e) => setStudentId(e.target.value)} autoComplete="off" spellCheck={false} data-testid="input-billing-student-id" />
          </div>
          <button type="submit" className={staffBtn.primary} disabled={!valid} data-testid="button-open-student-billing">Open billing</button>
        </form>
      </details>
    </StaffPage>
  );
}
