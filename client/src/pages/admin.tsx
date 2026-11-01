import React, { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users,
  GraduationCap,
  BookOpen,
  DollarSign,
  Activity,
  Search,
  ArrowRight,
  BarChart3,
  LifeBuoy,
  MailPlus,
  Archive,
} from "lucide-react";
import { apiRequest, ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT, type TranslationKey } from "@/i18n";
import { ProgramsManagement } from "@/components/programs-management";
import { KnowledgeSources } from "@/components/knowledge-sources";
import { InvitationsPanel } from "@/components/admin/invitations-panel";
import { Link, Redirect, useLocation, useSearch } from "wouter";
import { isSyntheticAccount } from "@shared/synthetic-accounts";
import {
  adminStudentWorkspacePath,
  adminTabFromSearch,
  adminTabPath,
  type AdminTab,
} from "./admin-student-workspace-presentation";
import {
  KpiTile,
  StaffAvatar,
  StaffCard,
  StaffEmpty,
  StaffPage,
  StaffPageHeader,
  StaffPill,
  StaffSectionHeader,
  StatusPill,
  staffBtn,
  staffField,
  staffLabel,
  staffTable,
} from "@/components/staff/staff-ui";
import { cn } from "@/lib/utils";
import type { StatusKey } from "./student-roadmap-presentation";

// Types
interface UserProfileRef { status?: string | null }
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
  profiles?: UserProfileRef | UserProfileRef[] | null;
}

interface Analytics {
  usersByRole: Record<string, number>;
  studentsByStatus: Record<string, number>;
  activeEnrollments: number;
  recentSignups: number;
  totalRevenue: number;
  hsEnrollments?: { active: number; pending: number };
  testAccounts?: { users: number; students: number };
}

export interface AuditLogEntry {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  action_description: string;
  created_at: string;
  actor_user_id?: string | null;
  /** Additive server fields: resolved names so the viewer never shows UUID fragments. */
  actor_name?: string | null;
  target_label?: string | null;
  target_student_id?: string | null;
}

const sentence = (raw: string) => {
  const spaced = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Student account status in the shared status language (Lumière tokens, icon + word). */
const STUDENT_STATUS: Record<string, { status: StatusKey; labelKey: TranslationKey }> = {
  active: { status: "progress", labelKey: "sa.status.active" },
  lead: { status: "submitted", labelKey: "sa.status.lead" },
  paused: { status: "attention", labelKey: "sa.status.paused" },
  graduated: { status: "official", labelKey: "sa.status.graduated" },
};

const ROLE_KEY: Record<string, TranslationKey> = { admin: "sa.role.admin", coach: "sa.role.coach", staff: "sa.role.staff", student: "sa.role.student" };

const SEVERITY_KEY: Record<AuditLogEntry["severity"], TranslationKey> = {
  info: "sa.sev.info", warning: "sa.sev.warning", error: "sa.sev.error", critical: "sa.sev.critical",
};

/** Server refusal codes -> translated explanation. */
export const ADMIN_ERROR_KEY: Record<string, TranslationKey> = {
  LAST_ADMIN: "sa.err.lastAdmin",
  SELF_DEMOTION: "sa.err.selfDemotion",
  SELF_ARCHIVE: "sa.err.selfArchive",
  REASON_REQUIRED: "sa.err.reason",
};

const selectTrigger = "h-10 min-h-10 rounded-lg border-student-line-strong bg-student-card text-student-ink";

const PAGE_SIZE = 25;
const AUDIT_PAGE_SIZE = 25;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Event filter choices: the sensitive operations staff actually investigate. */
export const AUDIT_EVENT_OPTIONS = [
  "admin.bulk_operation",
  "admin.role_changed",
  "admin.permission_granted",
  "admin.permission_revoked",
  "document.verified",
  "document.rejected",
  "document.uploaded",
  "profile.updated",
  "enrollment.status_changed",
  "payment.created",
  "auth.login.failure",
  "auth.password_change",
] as const;

function profileStatus(user: User): string | null {
  const p = Array.isArray(user.profiles) ? user.profiles[0] : user.profiles;
  return p?.status ?? null;
}

/** Proportional bar list: neutral ink fill, count printed (never colour alone, never a status). */
function DistributionList({ entries, label }: { entries: [string, number][]; label: (key: string) => string }) {
  const { t } = useT();
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (entries.length === 0) return <p className="text-sm text-student-muted">{t("sa.noData")}</p>;
  return (
    <ul className="space-y-3">
      {entries.map(([key, count]) => (
        <li key={key} className="space-y-1.5">
          <div className="flex items-baseline justify-between text-sm">
            <span className="text-student-ink">{label(key)}</span>
            <span className="font-semibold tabular-nums text-student-ink">{count}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-student-line" aria-hidden="true">
            <div className="h-full rounded-full bg-student-seal" style={{ width: `${(count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Labeled switch that reveals synthetic/test accounts; they are hidden by default. */
function TestAccountsToggle({ id, count, checked, onChange }: { id: string; count: number; checked: boolean; onChange: (v: boolean) => void }) {
  const { t } = useT();
  if (count === 0 && !checked) return null;
  return (
    <label htmlFor={id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
      <input id={id} type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      {t("sa.test.showAccounts", { count })}
    </label>
  );
}

function Pager({ from, to, total, onPrev, onNext, labelKeys, testId }: {
  from: number; to: number; total: number; onPrev: (() => void) | null; onNext: (() => void) | null;
  labelKeys: { showing: TranslationKey; prev: TranslationKey; next: TranslationKey }; testId: string;
}) {
  const { t } = useT();
  if (total <= 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-student-muted" data-testid={testId}>
      <span>{t(labelKeys.showing, { from, to, total })}</span>
      <span className="flex gap-2">
        <Button type="button" variant="outline" className={staffBtn.outline} disabled={!onPrev} onClick={() => onPrev?.()} data-testid={`${testId}-prev`}>{t(labelKeys.prev)}</Button>
        <Button type="button" variant="outline" className={staffBtn.outline} disabled={!onNext} onClick={() => onNext?.()} data-testid={`${testId}-next`}>{t(labelKeys.next)}</Button>
      </span>
    </div>
  );
}

// Dashboard Overview Tab
function DashboardOverview() {
  const { t } = useT();
  const { data: analytics, isLoading } = useQuery<{ analytics: Analytics }>({
    queryKey: ['/api/admin/analytics/dashboard'],
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">{t("sa.ov.loading")}</div>;
  }

  const stats = analytics?.analytics;
  const roleLabel = (role: string) => (ROLE_KEY[role] ? t(ROLE_KEY[role]) : sentence(role));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label={t("sa.ov.students")}
          value={stats?.studentsByStatus ? Object.values(stats.studentsByStatus).reduce((a, b) => a + b, 0) : 0}
          icon={<GraduationCap className="h-5 w-5" />}
        />
        <KpiTile label={t("sa.ov.enrollments")} value={stats?.activeEnrollments || 0} hint={stats?.hsEnrollments ? t("sa.ov.pendingHs", { count: stats.hsEnrollments.pending }) : undefined} icon={<BookOpen className="h-5 w-5" />} />
        <KpiTile label={t("sa.ov.signups")} value={stats?.recentSignups || 0} icon={<Users className="h-5 w-5" />} />
        <KpiTile label={t("sa.ov.payments")} hint={t("sa.ov.paymentsHint")} value={`$${((stats?.totalRevenue || 0) / 100).toLocaleString()}`} icon={<DollarSign className="h-5 w-5" />} />
      </div>

      {stats?.testAccounts && (stats.testAccounts.users > 0 || stats.testAccounts.students > 0) ? (
        <p className="text-xs text-student-muted" data-testid="overview-test-accounts-note">
          {t("sa.ov.testNote", { users: stats.testAccounts.users, students: stats.testAccounts.students })}
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StaffCard>
          <StaffSectionHeader title={t("sa.ov.usersByRole")} description={t("sa.ov.realAccounts")} />
          <DistributionList entries={Object.entries(stats?.usersByRole ?? {})} label={roleLabel} />
        </StaffCard>
        <StaffCard>
          <StaffSectionHeader title={t("sa.ov.studentsByStatus")} description={t("sa.ov.realStudents")} />
          <DistributionList entries={Object.entries(stats?.studentsByStatus ?? {})} label={(k) => (STUDENT_STATUS[k] ? t(STUDENT_STATUS[k].labelKey) : sentence(k))} />
        </StaffCard>
      </div>
    </div>
  );
}

/** Translated explanation for a failed admin call: known refusal codes first, then the server's own text. */
function adminErrorText(e: unknown, t: (k: TranslationKey) => string): string {
  if (e instanceof ApiError) {
    const key = e.code ? ADMIN_ERROR_KEY[e.code] : undefined;
    if (key) return t(key);
    if (e.message) return e.message;
  }
  return e instanceof Error && e.message ? e.message : t("sa.err.generic");
}

// Archive dialog (reason required, explicit confirmation, server-enforced guards)
function ArchiveUserDialog({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useT();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { setReason(""); setError(null); }, [user?.id]);
  const valid = reason.trim().length >= 5;

  const archive = useMutation({
    mutationFn: async () => apiRequest<{ success: boolean; sessionsRevoked?: boolean }>(`/api/admin/users/${user!.id}`, {
      method: "DELETE",
      body: JSON.stringify({ reason: reason.trim() }),
    }),
    onSuccess: (res) => {
      void queryClient.invalidateQueries({ queryKey: ["/api/admin/users"] });
      toast({ title: t("sa.archive.done"), description: res?.sessionsRevoked === false ? t("sa.archive.sessionsWarning") : undefined });
      onClose();
    },
    onError: (e: unknown) => setError(adminErrorText(e, t)),
  });

  return (
    <Dialog open={user !== null} onOpenChange={(o) => { if (!o && !archive.isPending) onClose(); }}>
      <DialogContent data-testid="archive-user-dialog">
        <DialogHeader>
          <DialogTitle>{t("sa.archive.title")}</DialogTitle>
          <DialogDescription>{t("sa.archive.description", { name: user?.name ?? "", email: user?.email ?? "" })}</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); if (valid && !archive.isPending) archive.mutate(); }}
        >
          <div className="space-y-1">
            <label className={cn(staffLabel, "block")} htmlFor="archive-reason">{t("sa.archive.reasonLabel")}</label>
            <textarea id="archive-reason" className={cn(staffField, "min-h-24 py-2")} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} data-testid="input-archive-reason" />
            <p className="text-xs text-student-muted">{t("sa.archive.reasonHint")}</p>
          </div>
          {error ? <p role="alert" className="text-sm text-st-urgent" data-testid="archive-error">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" className={staffBtn.outline} onClick={onClose} disabled={archive.isPending}>{t("sa.archive.cancel")}</Button>
            <Button type="submit" className={staffBtn.seal} disabled={!valid || archive.isPending} data-testid="button-archive-confirm">
              <Archive className="h-4 w-4" aria-hidden="true" />{archive.isPending ? t("sa.archive.pending") : t("sa.archive.confirm")}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// User Management Tab
function UserManagement() {
  const { t, language } = useT();
  const { user: me } = useAuth();
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showTest, setShowTest] = useState(false);
  const [page, setPage] = useState(0);
  const [archiveTarget, setArchiveTarget] = useState<User | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  useEffect(() => {
    const id = setTimeout(() => { setDebouncedSearch(search.trim()); setPage(0); }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const offset = page * PAGE_SIZE;
  const { data, isLoading, isError } = useQuery<{ users: User[]; pagination?: { total: number; limit: number; offset: number } }>({
    queryKey: ['/api/admin/users', { search: debouncedSearch || undefined, role: roleFilter !== 'all' ? roleFilter : undefined, limit: PAGE_SIZE, offset }],
  });

  const updateRoleMutation = useMutation({
    mutationFn: async ({ userId, role }: { userId: string; role: string }) => {
      return apiRequest(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: t("sa.users.roleUpdated") });
    },
    onError: (e: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: t("sa.users.roleNotChanged"), description: adminErrorText(e, t), variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">{t("sa.users.loading")}</div>;
  }
  const roleLabel = (role: string) => (ROLE_KEY[role] ? t(ROLE_KEY[role]) : sentence(role));
  const allUsers = data?.users ?? [];
  const total = data?.pagination?.total ?? allUsers.length;
  const testCount = allUsers.filter((u) => isSyntheticAccount(u)).length;
  const users = showTest ? allUsers : allUsers.filter((u) => !isSyntheticAccount(u));
  const hasNext = offset + allUsers.length < total;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
          <label htmlFor="admin-user-search" className="sr-only">{t("sa.users.searchLabel")}</label>
          <Input
            id="admin-user-search"
            placeholder={t("sa.users.searchPlaceholder")}
            className={cn(staffField, "pl-9")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(0); }}>
          <SelectTrigger className={cn(selectTrigger, "sm:w-44")} aria-label={t("sa.users.filterRole")}>
            <SelectValue placeholder={t("sa.users.filterRole")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t("sa.users.allRoles")}</SelectItem>
            <SelectItem value="student">{t("sa.role.student")}</SelectItem>
            <SelectItem value="coach">{t("sa.role.coach")}</SelectItem>
            <SelectItem value="staff">{t("sa.role.staff")}</SelectItem>
            <SelectItem value="admin">{t("sa.role.admin")}</SelectItem>
          </SelectContent>
        </Select>
        <TestAccountsToggle id="admin-users-show-test" count={testCount} checked={showTest} onChange={setShowTest} />
      </div>

      {isError ? <p role="alert" className="text-sm text-st-urgent">{t("sa.users.loadError")}</p> : null}

      <div className={cn(staffTable.frame, "relative overflow-x-auto")}>
        <table className={cn(staffTable.table, "min-w-[34rem]")}>
          <caption className="sr-only">{t("sa.users.caption")}</caption>
          <thead>
            <tr>
              <th scope="col" className={staffTable.th}>{t("sa.users.colName")}</th>
              <th scope="col" className={cn(staffTable.th, "hidden md:table-cell")}>{t("sa.users.colEmail")}</th>
              <th scope="col" className={staffTable.th}>{t("sa.users.colRole")}</th>
              <th scope="col" className={cn(staffTable.th, "hidden lg:table-cell")}>{t("sa.users.colJoined")}</th>
              <th scope="col" className={cn(staffTable.th, "text-right")}>{t("sa.users.colActions")}</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const archived = profileStatus(user) === "archived";
              const isMe = me?.id === user.id;
              return (
                <tr key={user.id} className={staffTable.tr} data-testid={`user-row-${user.id}`}>
                  <td className={staffTable.td}>
                    <div className="flex items-center gap-3">
                      <StaffAvatar name={user.name} />
                      <div className="min-w-0 max-w-[16rem]"><div className="flex min-w-0 items-center gap-2"><p className="min-w-0 truncate font-medium text-student-ink" title={user.name}>{user.name}</p>{isSyntheticAccount(user) ? <StaffPill tone="attention" className="shrink-0">{t("sa.test.badge")}</StaffPill> : null}{archived ? <StaffPill tone="dashed" className="shrink-0">{t("sa.users.archived")}</StaffPill> : null}{isMe ? <StaffPill tone="neutral" className="shrink-0">{t("sa.users.you")}</StaffPill> : null}</div><p className="min-w-0 truncate text-xs text-student-muted md:hidden" title={user.email}>{user.email}</p></div>
                    </div>
                  </td>
                  <td className={cn(staffTable.td, "hidden max-w-[16rem] text-student-muted md:table-cell")}><span className="block min-w-0 truncate" title={user.email}>{user.email}</span></td>
                  <td className={staffTable.td}><StaffPill tone={user.role === "admin" ? "seal" : "neutral"}>{roleLabel(user.role)}</StaffPill></td>
                  <td className={cn(staffTable.td, "hidden text-student-muted lg:table-cell")}>{new Date(user.created_at).toLocaleDateString(language)}</td>
                  <td className={cn(staffTable.td, "text-right")}>
                    <div className="flex items-center justify-end gap-2">
                      <Select
                        value={user.role}
                        onValueChange={(role) => {
                          // A role change alters what this account can see and do: confirm it explicitly.
                          if (role !== user.role && window.confirm(t("sa.users.confirmRole", { name: user.name, from: roleLabel(user.role), to: roleLabel(role) }))) {
                            updateRoleMutation.mutate({ userId: user.id, role });
                          }
                        }}
                      >
                        <SelectTrigger className={cn(selectTrigger, "w-32")} aria-label={t("sa.users.changeRoleFor", { name: user.name })}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="student">{t("sa.role.student")}</SelectItem>
                          <SelectItem value="coach">{t("sa.role.coach")}</SelectItem>
                          <SelectItem value="staff">{t("sa.role.staff")}</SelectItem>
                          <SelectItem value="admin">{t("sa.role.admin")}</SelectItem>
                        </SelectContent>
                      </Select>
                      {!archived && !isMe ? (
                        <Button type="button" variant="outline" className={staffBtn.outline} onClick={() => setArchiveTarget(user)} aria-label={t("sa.users.archiveFor", { name: user.name })} data-testid={`button-archive-${user.id}`}>
                          <Archive className="h-4 w-4" aria-hidden="true" /><span className="hidden xl:inline">{t("sa.users.archiveButton")}</span>
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!users.length && <p className="px-4 py-6 text-center text-sm text-student-muted">{t("sa.users.noMatch")}</p>}
      </div>

      <Pager
        testId="users-pager"
        from={allUsers.length ? offset + 1 : 0}
        to={offset + allUsers.length}
        total={total}
        onPrev={page > 0 ? () => setPage(page - 1) : null}
        onNext={hasNext ? () => setPage(page + 1) : null}
        labelKeys={{ showing: "sa.users.showing", prev: "sa.users.prev", next: "sa.users.next" }}
      />

      <ArchiveUserDialog user={archiveTarget} onClose={() => setArchiveTarget(null)} />
    </div>
  );
}

export interface AuditFilters { eventType: string; from: string; to: string; target: string }
export const EMPTY_AUDIT_FILTERS: AuditFilters = { eventType: "", from: "", to: "", target: "" };

/** Pure presentation of the audit viewer (testable without a network). */
export function AuditLogsView({
  logs, total, offset, pageSize, draft, onDraft, onApply, onReset, onPrev, onNext, isError, onRetry, targetInvalid,
}: {
  logs: AuditLogEntry[]; total: number; offset: number; pageSize: number;
  draft: AuditFilters; onDraft: (next: AuditFilters) => void; onApply: () => void; onReset: () => void;
  onPrev: (() => void) | null; onNext: (() => void) | null; isError: boolean; onRetry: () => void; targetInvalid: boolean;
}) {
  const { t, language } = useT();
  void pageSize;
  return (
    <div className="space-y-4">
      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_auto_auto_minmax(0,1.2fr)_auto] lg:items-end"
        onSubmit={(e) => { e.preventDefault(); onApply(); }}
        data-testid="audit-filters"
      >
        <div className="space-y-1">
          <label className={cn(staffLabel, "block")} htmlFor="audit-event">{t("sa.audit.filterEvent")}</label>
          <select id="audit-event" className={staffField} value={draft.eventType} onChange={(e) => onDraft({ ...draft, eventType: e.target.value })} data-testid="audit-filter-event">
            <option value="">{t("sa.audit.allEvents")}</option>
            {AUDIT_EVENT_OPTIONS.map((ev) => <option key={ev} value={ev}>{ev}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label className={cn(staffLabel, "block")} htmlFor="audit-from">{t("sa.audit.from")}</label>
          <input id="audit-from" type="date" className={staffField} value={draft.from} max={draft.to || undefined} onChange={(e) => onDraft({ ...draft, from: e.target.value })} data-testid="audit-filter-from" />
        </div>
        <div className="space-y-1">
          <label className={cn(staffLabel, "block")} htmlFor="audit-to">{t("sa.audit.to")}</label>
          <input id="audit-to" type="date" className={staffField} value={draft.to} min={draft.from || undefined} onChange={(e) => onDraft({ ...draft, to: e.target.value })} data-testid="audit-filter-to" />
        </div>
        <div className="space-y-1 sm:col-span-2 lg:col-span-1">
          <label className={cn(staffLabel, "block")} htmlFor="audit-target">{t("sa.audit.target")}</label>
          <input id="audit-target" type="text" className={staffField} value={draft.target} placeholder={t("sa.audit.targetPlaceholder")} onChange={(e) => onDraft({ ...draft, target: e.target.value.trim() })} aria-invalid={targetInvalid} data-testid="audit-filter-target" />
          {targetInvalid ? <p role="alert" className="text-xs text-st-urgent">{t("sa.audit.targetInvalid")}</p> : null}
        </div>
        <div className="flex gap-2 sm:col-span-2 lg:col-span-1">
          <Button type="submit" className={staffBtn.primary} disabled={targetInvalid} data-testid="audit-apply">{t("sa.audit.apply")}</Button>
          <Button type="button" variant="outline" className={staffBtn.outline} onClick={onReset} data-testid="audit-reset">{t("sa.audit.reset")}</Button>
        </div>
      </form>

      <StaffCard>
        <StaffSectionHeader title={t("sa.audit.title")} description={t("sa.audit.description")} />
        {isError ? <p role="alert" className="text-sm text-st-urgent">{t("sa.audit.loadError")} <button type="button" className="font-semibold underline underline-offset-4" onClick={onRetry}>{t("sa.audit.retry")}</button></p> : null}
        {!isError && logs.length === 0 ? (
          <StaffEmpty icon={<Activity className="h-6 w-6" />} title={t("sa.audit.emptyTitle")}>{t("sa.audit.emptyBody")}</StaffEmpty>
        ) : null}
        <ul className="space-y-2" data-testid="audit-list">
          {logs.map((log) => (
            <li key={log.id} className="flex items-start gap-3 rounded-xl border border-student-line p-3" data-testid={`audit-row-${log.id}`}>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-student-gold-soft px-1.5 py-0.5 text-xs text-student-ink">{log.event_type}</code>
                  <StaffPill tone={log.severity === "critical" || log.severity === "error" ? "urgent" : log.severity === "warning" ? "attention" : "neutral"}>{t(SEVERITY_KEY[log.severity] ?? "sa.sev.info")}</StaffPill>
                </div>
                <p className="mt-1 text-sm text-student-ink [overflow-wrap:anywhere]">{log.action_description}</p>
                <p className="mt-1 text-xs text-student-muted">
                  {new Date(log.created_at).toLocaleString(language)}
                  {` • ${t("sa.audit.actor")}: `}<span data-testid="audit-actor">{log.actor_name || (log.actor_user_id ? log.actor_user_id.substring(0, 8) : t("sa.audit.system"))}</span>
                  {log.target_label ? <>{` • ${t("sa.audit.targetShort")}: `}<span data-testid="audit-target">{log.target_label}</span></> : null}
                  {log.target_student_id ? <>{" • "}<Link href={adminStudentWorkspacePath(log.target_student_id)} className="font-semibold underline underline-offset-4" data-testid="audit-student-link">{t("sa.audit.openStudent")}</Link></> : null}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-4">
          <Pager
            testId="audit-pager"
            from={logs.length ? offset + 1 : 0}
            to={offset + logs.length}
            total={total}
            onPrev={onPrev}
            onNext={onNext}
            labelKeys={{ showing: "sa.audit.showing", prev: "sa.audit.prev", next: "sa.audit.next" }}
          />
        </div>
      </StaffCard>
    </div>
  );
}

// Audit Logs Tab
function AuditLogs() {
  const { t } = useT();
  const [draft, setDraft] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [applied, setApplied] = useState<AuditFilters>(EMPTY_AUDIT_FILTERS);
  const [page, setPage] = useState(0);
  const offset = page * AUDIT_PAGE_SIZE;
  const targetInvalid = draft.target !== "" && !UUID_RE.test(draft.target);

  const { data, isLoading, isError, refetch } = useQuery<{ logs: AuditLogEntry[]; pagination?: { total: number } }>({
    queryKey: ['/api/admin/audit-logs', {
      limit: AUDIT_PAGE_SIZE,
      offset,
      eventType: applied.eventType || undefined,
      startDate: applied.from || undefined,
      endDate: applied.to || undefined,
      targetId: applied.target || undefined,
    }],
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">{t("sa.audit.loading")}</div>;
  }
  const logs = data?.logs ?? [];
  const total = data?.pagination?.total ?? logs.length;

  return (
    <AuditLogsView
      logs={logs}
      total={total}
      offset={offset}
      pageSize={AUDIT_PAGE_SIZE}
      draft={draft}
      onDraft={setDraft}
      onApply={() => { if (!targetInvalid) { setApplied(draft); setPage(0); } }}
      onReset={() => { setDraft(EMPTY_AUDIT_FILTERS); setApplied(EMPTY_AUDIT_FILTERS); setPage(0); }}
      onPrev={page > 0 ? () => setPage(page - 1) : null}
      onNext={offset + logs.length < total ? () => setPage(page + 1) : null}
      isError={isError}
      onRetry={() => void refetch()}
      targetInvalid={targetInvalid}
    />
  );
}

const TAB_TRIGGER =
  "min-h-11 gap-2 rounded-none rounded-t-lg border-b-2 border-transparent px-4 py-2 text-student-muted shadow-none hover:bg-student-gold-soft/50 hover:text-student-ink data-[state=active]:border-student-gold-ink data-[state=active]:bg-student-card data-[state=active]:text-student-ink data-[state=active]:shadow-none focus-visible:ring-student-gold-ink";

// Main Admin Dashboard
export default function Admin() {
  const { t } = useT();
  const [, setLocation] = useLocation();
  const search = useSearch();
  const selectedTab = adminTabFromSearch(search);
  // The directory moved to its own page; the legacy /admin?tab=students link keeps working.
  if (selectedTab === "students") return <Redirect to="/admin/students" />;
  return (
    <StaffPage>
      <StaffPageHeader
        eyebrow={t("sa.page.eyebrow")}
        title={t("sa.page.title")}
        description={t("sa.page.description")}
      />

      <Link
        href="/admin/support-center"
        className="flex items-center justify-between gap-3 rounded-2xl border-2 border-student-gold-ink bg-student-gold-soft p-4 text-student-ink hover:bg-student-gold-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink"
        data-testid="link-support-center"
      >
        <span className="flex min-w-0 items-center gap-3">
          <LifeBuoy className="h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-serif text-lg">{t("sa.cc.title")}</span>
            <span className="block text-sm text-student-muted">{t("sa.cc.desc")}</span>
          </span>
        </span>
        <ArrowRight className="h-5 w-5 shrink-0" aria-hidden="true" />
      </Link>

      <Tabs
        value={selectedTab}
        onValueChange={(tab) => setLocation(adminTabPath(tab as AdminTab))}
        className="space-y-4"
      >
        <div className="-mx-1 overflow-x-auto px-1">
          <TabsList className="h-auto min-w-max justify-start gap-1 rounded-none border-b border-student-line bg-transparent p-0">
            <TabsTrigger value="overview" className={TAB_TRIGGER}>
              <BarChart3 className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.overview")}
            </TabsTrigger>
            <TabsTrigger value="users" className={TAB_TRIGGER}>
              <Users className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.users")}
            </TabsTrigger>
            <TabsTrigger value="invitations" className={TAB_TRIGGER} data-testid="tab-invitations">
              <MailPlus className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.invitations")}
            </TabsTrigger>
            <TabsTrigger value="programs" className={TAB_TRIGGER}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.programs")}
            </TabsTrigger>
            <TabsTrigger value="knowledge" className={TAB_TRIGGER}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.knowledge")}
            </TabsTrigger>
            <TabsTrigger value="logs" className={TAB_TRIGGER}>
              <Activity className="h-4 w-4" aria-hidden="true" />
              {t("sa.tab.logs")}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0">
          <DashboardOverview />
        </TabsContent>

        <TabsContent value="users" className="mt-0">
          <UserManagement />
        </TabsContent>

        <TabsContent value="invitations" className="mt-0">
          <InvitationsPanel />
        </TabsContent>

        <TabsContent value="programs" className="mt-0">
          <ProgramsManagement />
        </TabsContent>

        <TabsContent value="knowledge" className="mt-0">
          <KnowledgeSources />
        </TabsContent>

        <TabsContent value="logs" className="mt-0">
          <AuditLogs />
        </TabsContent>
      </Tabs>
    </StaffPage>
  );
}
