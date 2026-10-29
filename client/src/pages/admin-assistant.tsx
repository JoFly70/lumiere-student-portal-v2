import React, { useState } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Search } from "lucide-react";
import { api } from "@/lib/api";
import { StaffEmpty, StaffPage, StaffPageHeader, staffBtn, staffField } from "@/components/staff/staff-ui";
import { OwnerAssistantPanel } from "@/components/owner-assistant/owner-assistant-panel";

interface StudentRow { id: string; first_name: string; last_name: string; preferred_name?: string | null; student_code?: string | null; status: string }

/** S26: Lumière Owner AI. Pick a student (search, no raw IDs), then ask about that student's records. */
export default function AdminAssistant() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const studentId = new URLSearchParams(search).get("studentId");
  const [term, setTerm] = useState("");
  const students = useQuery<{ students: StudentRow[]; total: number }>({
    queryKey: ["/api/students", "assistant-picker", term],
    queryFn: () => api.get(`/api/students?limit=25${term.trim() ? `&search=${encodeURIComponent(term.trim())}` : ""}`),
  });
  const selected = students.data?.students.find((s) => s.id === studentId);
  const label = selected ? `${selected.preferred_name || selected.first_name} ${selected.last_name}` : undefined;

  return (
    <StaffPage width="wide" testId="admin-assistant">
      <StaffPageHeader
        eyebrow="Admin tools"
        title="Lumière Owner AI"
        description="Ask questions about one student's authorized records. Answers cite the records they come from; nothing is changed."
      />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-3 rounded-xl border border-student-line bg-student-card p-4" aria-label="Choose a student">
          <label htmlFor="assistant-student-search" className="text-sm font-medium text-student-ink">Student</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-student-muted" aria-hidden="true" />
            <input id="assistant-student-search" className={`${staffField} pl-8`} placeholder="Name or student code" value={term} onChange={(e) => setTerm(e.target.value)} data-testid="assistant-student-search" />
          </div>
          <ul className="max-h-[420px] space-y-1 overflow-y-auto" data-testid="assistant-student-list">
            {(students.data?.students ?? []).map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => navigate(`/admin/assistant?studentId=${encodeURIComponent(s.id)}`)}
                  className={`min-h-11 w-full rounded-md px-3 py-2 text-left text-sm ${s.id === studentId ? "bg-student-gold-soft font-semibold text-student-ink" : "hover:bg-student-gold-soft/60"}`}
                  aria-current={s.id === studentId ? "true" : undefined}
                >
                  {s.preferred_name || s.first_name} {s.last_name}
                  <span className="block text-xs text-student-muted">{s.student_code ?? ""} · {s.status}</span>
                </button>
              </li>
            ))}
            {students.isLoading && <li role="status" className="px-3 py-2 text-sm text-student-muted">Loading students…</li>}
            {students.isError && <li role="alert" className="px-3 py-2 text-sm text-st-urgent">Students could not be loaded. <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void students.refetch()}>Retry</button></li>}
            {students.data && students.data.students.length === 0 && <li className="px-3 py-2 text-sm text-student-muted">No students match{term.trim() ? ` “${term.trim()}”` : ""}.</li>}
          </ul>
        </aside>
        <div className="rounded-xl border border-student-line bg-student-card p-5 sm:p-6">
          {studentId ? (
            <>
              <OwnerAssistantPanel key={studentId} studentId={studentId} studentLabel={label} />
              <Link href={`/admin/students/${encodeURIComponent(studentId)}`} className={`${staffBtn.outline} mt-6 inline-flex items-center gap-2 border`}>
                Open the student's file <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </>
          ) : (
            <StaffEmpty title="Choose a student" testId="assistant-no-student">
              Owner AI works on one student file at a time, so its answers can only use that student's records.
            </StaffEmpty>
          )}
        </div>
      </div>
    </StaffPage>
  );
}
