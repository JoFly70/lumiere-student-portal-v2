/**
 * Shared owner-side student directory data: one list request, one aggregate-facts request (program, balance,
 * last activity), demo/test classification and the avatar. Used by the Control Center and /admin/students.
 */
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { isSyntheticAccount } from "@shared/synthetic-accounts";
import { apiRequest } from "@/lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { avatarInitials, safePhotoUrl } from "@/lib/avatar";
import { cn } from "@/lib/utils";
import { StaffPill, StatusPill } from "@/components/staff/staff-ui";
import type { StatusKey } from "@/pages/student-roadmap-presentation";

export interface DirectoryStudent {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name?: string | null;
  student_code?: string | null;
  email?: string | null;
  status: string;
  user_id?: string | null;
  photo_url?: string | null;
  created_at?: string | null;
}

export interface DirectoryFacts {
  studentId: string;
  program: { title: string; status: string; kind?: "high_school" | "degree" } | null;
  billing: { currency: string; agreedCents: number; netCents: number; paidCents: number; balanceCents: number; overdue: boolean } | null;
  lastActivityAt: string | null;
}

export const isDemoStudent = (s: Pick<DirectoryStudent, "first_name" | "last_name" | "preferred_name" | "email">): boolean =>
  isSyntheticAccount({ email: s.email, first_name: s.first_name, preferred_name: s.preferred_name, name: `${s.first_name} ${s.last_name}` });

export function studentFullName(s: Pick<DirectoryStudent, "first_name" | "last_name" | "preferred_name">): string {
  const first = s.preferred_name && !/^DEMO/i.test(s.preferred_name) ? s.preferred_name : s.first_name;
  return `${first} ${s.last_name}`.replace(/\s*\((?:NOT A REAL STUDENT|SYNTHETIC)[^)]*\)/gi, "").replace(/\s+/g, " ").trim();
}

/** "Accredited U.S. High School Diploma (21 credits)" reads better in a table as "U.S. High School Diploma · 21 credits". */
export function shortProgram(title: string): string {
  return title.replace(/^Accredited\s+/i, "").replace(/\s*\((\d+(?:\.5)?) credits\)/i, " · $1 credits");
}

export const sentence = (raw: string): string => {
  const t = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
};

export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
  } catch {
    return `${(cents / 100).toFixed(2)} ${currency}`;
  }
}

export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "No activity yet";
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return "No activity yet";
  const day = 86_400_000;
  if (ms < 3_600_000) return "Just now";
  if (ms < day) return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 2 * day) return "Yesterday";
  if (ms < 30 * day) return `${Math.floor(ms / day)} days ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function useDirectoryStudents(search = "") {
  const q = search.trim();
  return useQuery<{ students: DirectoryStudent[]; total?: number; pagination?: { total: number } }>({
    queryKey: ["/api/students", "directory", q],
    queryFn: () => apiRequest(`/api/students?limit=200${q ? `&search=${encodeURIComponent(q)}` : ""}`),
  });
}

export function useDirectoryFacts() {
  return useQuery<{ facts: DirectoryFacts[] }>({
    queryKey: ["/api/admin/directory/students"],
    queryFn: () => apiRequest("/api/admin/directory/students"),
    retry: false,
  });
}

export function factsById(facts: readonly DirectoryFacts[] | undefined): Map<string, DirectoryFacts> {
  return new Map((facts ?? []).map((f) => [f.studentId, f]));
}

export function StudentPhoto({ student, size = "md", className }: { student: Pick<DirectoryStudent, "first_name" | "last_name" | "preferred_name" | "email" | "photo_url">; size?: "sm" | "md" | "lg"; className?: string }) {
  const src = safePhotoUrl(student.photo_url);
  const dim = size === "sm" ? "h-8 w-8 text-[11px]" : size === "lg" ? "h-14 w-14 text-base" : "h-10 w-10 text-xs";
  return (
    <Avatar className={cn("shrink-0", dim, className)}>
      {src ? <AvatarImage src={src} alt="" /> : null}
      <AvatarFallback className="bg-student-gold-soft font-semibold text-student-gold-ink ring-1 ring-student-gold/40">
        {avatarInitials(student.first_name, student.last_name, studentFullName(student), student.email)}
      </AvatarFallback>
    </Avatar>
  );
}

const STATUS: Record<string, { status: StatusKey; label: string }> = {
  active: { status: "progress", label: "Active" },
  lead: { status: "submitted", label: "Pre-enrollment" },
  paused: { status: "attention", label: "Paused" },
  graduated: { status: "official", label: "Graduated" },
};
export const STUDENT_STATUS_OPTIONS = [
  { value: "all", label: "All statuses" },
  { value: "lead", label: "Pre-enrollment" },
  { value: "active", label: "Active" },
  { value: "paused", label: "Paused" },
  { value: "graduated", label: "Graduated" },
] as const;

export function studentStatusLabel(status: string): string {
  return STATUS[status]?.label ?? sentence(status);
}

export function StudentStatusPill({ status }: { status: string }) {
  const m = STATUS[status] ?? { status: "notstarted" as StatusKey, label: sentence(status) };
  return <StatusPill status={m.status} label={m.label} />;
}

/** The unmistakable synthetic marker shown on every row/header of a demo student. */
export function DemoPill({ className }: { className?: string }) {
  return <StaffPill tone="attention" className={cn("shrink-0 uppercase tracking-wide", className)} testId="demo-pill">Demo</StaffPill>;
}

/** Ticket list rows carry the reporter's user id (not the student id): map it through the student's linked login. */
export function studentIdByUserId(students: readonly DirectoryStudent[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const s of students) if (s.user_id) m.set(s.user_id, s.id);
  return m;
}

export function isDemoTicket(t: { reporter_email?: string; reporter_name?: string; reporter_id?: string }, demoUserIds: ReadonlySet<string>): boolean {
  return (t.reporter_id ? demoUserIds.has(t.reporter_id) : false) || isSyntheticAccount({ email: t.reporter_email, name: t.reporter_name });
}
