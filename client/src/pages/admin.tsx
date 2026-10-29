import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
} from "lucide-react";
import { apiRequest } from "@/lib/api";
import { AddStudentDialog } from "@/components/admin/add-student-dialog";
import { ProgramsManagement } from "@/components/programs-management";
import { KnowledgeSources } from "@/components/knowledge-sources";
import { Link, useLocation, useSearch } from "wouter";
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
  staffTable,
} from "@/components/staff/staff-ui";
import { cn } from "@/lib/utils";
import type { StatusKey } from "./student-roadmap-presentation";

// Types
interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

interface Student {
  preferred_name?: string | null;
  id: string;
  student_code: string;
  first_name: string;
  last_name: string;
  email: string;
  status: string;
  residency: string;
  created_at: string;
}

interface Analytics {
  usersByRole: Record<string, number>;
  studentsByStatus: Record<string, number>;
  activeEnrollments: number;
  recentSignups: number;
  totalRevenue: number;
  testAccounts?: { users: number; students: number };
}

interface AuditLogEntry {
  id: string;
  event_type: string;
  severity: 'info' | 'warning' | 'error' | 'critical';
  action_description: string;
  created_at: string;
  actor_user_id?: string;
}

const sentence = (raw: string) => {
  const spaced = raw.replace(/[_-]+/g, " ").trim().toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

/** Student account status in the shared status language (Lumière tokens, icon + word). */
const STUDENT_STATUS: Record<string, { status: StatusKey; label: string }> = {
  active: { status: "progress", label: "Active" },
  lead: { status: "submitted", label: "Lead" },
  paused: { status: "attention", label: "Paused" },
  graduated: { status: "official", label: "Graduated" },
};
function StudentStatusPill({ status }: { status: string }) {
  const m = STUDENT_STATUS[status] ?? { status: "notstarted" as StatusKey, label: sentence(status) };
  return <StatusPill status={m.status} label={m.label} />;
}

const ROLE_LABEL: Record<string, string> = { admin: "Administrator", coach: "Coach", staff: "Staff", student: "Student" };
const roleLabel = (role: string) => ROLE_LABEL[role] ?? sentence(role);

const selectTrigger = "h-10 min-h-10 rounded-lg border-student-line-strong bg-student-card text-student-ink";

/** Proportional bar list: neutral ink fill, count printed (never colour alone, never a status). */
function DistributionList({ entries, label }: { entries: [string, number][]; label: (key: string) => string }) {
  const max = Math.max(1, ...entries.map(([, n]) => n));
  if (entries.length === 0) return <p className="text-sm text-student-muted">No data yet.</p>;
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
function TestAccountsToggle({ id, count, checked, onChange, noun = "accounts" }: { id: string; count: number; checked: boolean; onChange: (v: boolean) => void; noun?: string }) {
  if (count === 0 && !checked) return null;
  return (
    <label htmlFor={id} className="inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-student-ink">
      <input id={id} type="checkbox" className="h-4 w-4 accent-[hsl(var(--s-ink))]" checked={checked} onChange={(e) => onChange(e.target.checked)} data-testid={id} />
      Show test {noun} ({count})
    </label>
  );
}

// Dashboard Overview Tab
function DashboardOverview() {
  const { data: analytics, isLoading } = useQuery<{ analytics: Analytics }>({
    queryKey: ['/api/admin/analytics/dashboard'],
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">Loading analytics...</div>;
  }

  const stats = analytics?.analytics;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiTile
          label="Students (excl. test)"
          value={stats?.studentsByStatus ? Object.values(stats.studentsByStatus).reduce((a, b) => a + b, 0) : 0}
          icon={<GraduationCap className="h-5 w-5" />}
        />
        <KpiTile label="Active enrollments" value={stats?.activeEnrollments || 0} icon={<BookOpen className="h-5 w-5" />} />
        <KpiTile label="New signups (30d)" value={stats?.recentSignups || 0} icon={<Users className="h-5 w-5" />} />
        <KpiTile label="Revenue (30d)" value={`$${((stats?.totalRevenue || 0) / 100).toLocaleString()}`} icon={<DollarSign className="h-5 w-5" />} />
      </div>

      {stats?.testAccounts && (stats.testAccounts.users > 0 || stats.testAccounts.students > 0) ? (
        <p className="text-xs text-student-muted" data-testid="overview-test-accounts-note">
          Real accounts only. Excluded from these counts: {stats.testAccounts.users} test user{stats.testAccounts.users === 1 ? "" : "s"} and {stats.testAccounts.students} test student{stats.testAccounts.students === 1 ? "" : "s"}.
        </p>
      ) : null}

      <div className="grid gap-4 md:grid-cols-2">
        <StaffCard>
          <StaffSectionHeader title="Users by role" description="Real accounts only" />
          <DistributionList entries={Object.entries(stats?.usersByRole ?? {})} label={roleLabel} />
        </StaffCard>
        <StaffCard>
          <StaffSectionHeader title="Students by status" description="Real students only" />
          <DistributionList entries={Object.entries(stats?.studentsByStatus ?? {})} label={(k) => STUDENT_STATUS[k]?.label ?? sentence(k)} />
        </StaffCard>
      </div>

      <StaffCard>
        <StaffSectionHeader title="Recent activity" description="Latest verified actions in the system" />
        <StaffEmpty icon={<Activity className="h-6 w-6" />} title="Activity feed not connected">
          No sample activity is shown. Verified activity will appear here when the feed is connected.
        </StaffEmpty>
      </StaffCard>
    </div>
  );
}

// User Management Tab
function UserManagement() {
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("all");
  const [showTest, setShowTest] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery<{ users: User[] }>({
    queryKey: ['/api/admin/users', { search, role: roleFilter !== 'all' ? roleFilter : undefined }],
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
      toast({ title: "Role updated successfully" });
    },
    onError: (e: unknown) => {
      queryClient.invalidateQueries({ queryKey: ['/api/admin/users'] });
      toast({ title: "The role was not changed", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
    },
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">Loading users...</div>;
  }
  const allUsers = data?.users ?? [];
  const testCount = allUsers.filter((u) => isSyntheticAccount(u)).length;
  const users = showTest ? allUsers : allUsers.filter((u) => !isSyntheticAccount(u));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
          <label htmlFor="admin-user-search" className="sr-only">Search users by name or email</label>
          <Input
            id="admin-user-search"
            placeholder="Search users by name or email..."
            className={cn(staffField, "pl-9")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={roleFilter} onValueChange={setRoleFilter}>
          <SelectTrigger className={cn(selectTrigger, "sm:w-44")} aria-label="Filter by role">
            <SelectValue placeholder="Filter by role" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All roles</SelectItem>
            <SelectItem value="student">Student</SelectItem>
            <SelectItem value="coach">Coach</SelectItem>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="admin">Admin</SelectItem>
          </SelectContent>
        </Select>
        <TestAccountsToggle id="admin-users-show-test" count={testCount} checked={showTest} onChange={setShowTest} />
      </div>

      <div className={cn(staffTable.frame, "overflow-x-auto")}>
        <table className={cn(staffTable.table, "min-w-[34rem]")}>
          <caption className="sr-only">Users</caption>
          <thead>
            <tr>
              <th scope="col" className={staffTable.th}>Name</th>
              <th scope="col" className={cn(staffTable.th, "hidden md:table-cell")}>Email</th>
              <th scope="col" className={staffTable.th}>Role</th>
              <th scope="col" className={cn(staffTable.th, "hidden lg:table-cell")}>Joined</th>
              <th scope="col" className={cn(staffTable.th, "text-right")}>Change role</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id} className={staffTable.tr}>
                <td className={staffTable.td}>
                  <div className="flex items-center gap-3">
                    <StaffAvatar name={user.name} />
                    <div className="min-w-0 max-w-[16rem]"><div className="flex min-w-0 items-center gap-2"><p className="min-w-0 truncate font-medium text-student-ink" title={user.name}>{user.name}</p>{isSyntheticAccount(user) ? <StaffPill tone="attention" className="shrink-0">Test account</StaffPill> : null}</div><p className="min-w-0 truncate text-xs text-student-muted md:hidden" title={user.email}>{user.email}</p></div>
                  </div>
                </td>
                <td className={cn(staffTable.td, "hidden max-w-[16rem] text-student-muted md:table-cell")}><span className="block min-w-0 truncate" title={user.email}>{user.email}</span></td>
                <td className={staffTable.td}><StaffPill tone={user.role === "admin" ? "seal" : "neutral"}>{roleLabel(user.role)}</StaffPill></td>
                <td className={cn(staffTable.td, "hidden text-student-muted lg:table-cell")}>{new Date(user.created_at).toLocaleDateString()}</td>
                <td className={cn(staffTable.td, "text-right")}>
                  <Select
                    value={user.role}
                    onValueChange={(role) => updateRoleMutation.mutate({ userId: user.id, role })}
                  >
                    <SelectTrigger className={cn(selectTrigger, "ml-auto w-32")} aria-label={`Change role for ${user.name}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="student">Student</SelectItem>
                      <SelectItem value="coach">Coach</SelectItem>
                      <SelectItem value="staff">Staff</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!users.length && <p className="px-4 py-6 text-center text-sm text-student-muted">No users match.</p>}
      </div>
    </div>
  );
}

// Student Management Tab
function StudentManagement() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [showTest, setShowTest] = useState(false);
  const [, setLocation] = useLocation();

  const { data, isLoading } = useQuery<{ students: Student[] }>({
    queryKey: ['/api/admin/students', { search, status: statusFilter !== 'all' ? statusFilter : undefined }],
  });

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">Loading students...</div>;
  }
  const isTest = (st: Student) => isSyntheticAccount({ email: st.email, first_name: st.first_name, preferred_name: st.preferred_name, name: `${st.first_name} ${st.last_name}` });
  const allStudents = data?.students ?? [];
  const testCount = allStudents.filter(isTest).length;
  const students = showTest ? allStudents : allStudents.filter((st) => !isTest(st));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-student-muted" aria-hidden="true" />
          <label htmlFor="admin-student-search" className="sr-only">Search students</label>
          <Input
            id="admin-student-search"
            placeholder="Search students..."
            className={cn(staffField, "pl-9")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className={cn(selectTrigger, "sm:w-44")} aria-label="Filter by status">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="graduated">Graduated</SelectItem>
          </SelectContent>
        </Select>
        <TestAccountsToggle id="admin-students-show-test" count={testCount} checked={showTest} onChange={setShowTest} noun="students" />
        <AddStudentDialog />
      </div>

      <div className={cn(staffTable.frame, "overflow-x-auto")}>
        <table className={cn(staffTable.table, "min-w-[22rem] sm:min-w-[32rem]")} data-testid="students-table">
          <caption className="sr-only">Students</caption>
          <thead>
            <tr>
              <th scope="col" className={staffTable.th}>Student</th>
              <th scope="col" className={cn(staffTable.th, "hidden md:table-cell")}>Code</th>
              <th scope="col" className={cn(staffTable.th, "hidden sm:table-cell")}>Status</th>
              <th scope="col" className={cn(staffTable.th, "hidden lg:table-cell")}>Residency</th>
              <th scope="col" className={cn(staffTable.th, "text-right")}><span className="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {students.map((student) => (
              <tr key={student.id} className={staffTable.tr}>
                <td className={staffTable.td}>
                  <div className="flex items-center gap-3">
                    <StaffAvatar name={`${student.first_name} ${student.last_name}`} />
                    <div className="min-w-0 max-w-[14rem] sm:max-w-[18rem]">
                      <div className="flex min-w-0 items-center gap-2"><p className="min-w-0 truncate font-medium text-student-ink" title={`${student.first_name} ${student.last_name}`}>{student.first_name} {student.last_name}</p>{isTest(student) ? <StaffPill tone="attention" className="shrink-0">Test account</StaffPill> : null}</div>
                      <p className="min-w-0 truncate text-xs text-student-muted" title={student.email}>{student.email}</p>
                      <div className="mt-1 sm:hidden"><StudentStatusPill status={student.status} /></div>
                    </div>
                  </div>
                </td>
                <td className={cn(staffTable.td, "hidden font-mono text-xs text-student-muted md:table-cell")}>{student.student_code}</td>
                <td className={cn(staffTable.td, "hidden sm:table-cell")}><StudentStatusPill status={student.status} /></td>
                <td className={cn(staffTable.td, "hidden text-student-muted lg:table-cell")}>{sentence(student.residency)}</td>
                <td className={cn(staffTable.td, "text-right")}>
                  <Button variant="outline" size="sm" className={staffBtn.outline} aria-label={`Open ${student.first_name} ${student.last_name}`} onClick={() => setLocation(adminStudentWorkspacePath(student.id))}>
                    <span className="hidden sm:inline">Open workspace</span><ArrowRight className="h-4 w-4" aria-hidden="true" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!students.length && <p className="px-4 py-6 text-center text-sm text-student-muted">No students match.</p>}
      </div>
    </div>
  );
}

// Audit Logs Tab
function AuditLogs() {
  const [dateRange, setDateRange] = useState("7d");

  const { data, isLoading, isError, refetch } = useQuery<{ logs: AuditLogEntry[] }>({
    queryKey: ['/api/admin/audit-logs', { limit: 100 }],
  });
  const days = { "1d": 1, "7d": 7, "30d": 30, "90d": 90 }[dateRange] ?? 7;
  const since = Date.now() - days * 86_400_000;
  const logs = (data?.logs ?? []).filter((l) => new Date(l.created_at).getTime() >= since);

  if (isLoading) {
    return <div className="py-12 text-center text-student-muted">Loading audit logs...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className={cn(selectTrigger, "w-48")} aria-label="Date range">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="1d">Last 24 hours</SelectItem>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <StaffCard>
        <StaffSectionHeader title="Recent activity log" description="FERPA-compliant audit trail of all sensitive operations" />
        {isError ? <p role="alert" className="text-sm text-st-urgent">The audit log could not be loaded. <button type="button" className="font-semibold underline underline-offset-4" onClick={() => void refetch()}>Retry</button></p> : null}
        {!isError && logs.length === 0 ? (
          <StaffEmpty icon={<Activity className="h-6 w-6" />} title="No activity in this period">Choose a longer range to see earlier entries.</StaffEmpty>
        ) : null}
        <ul className="space-y-2">
          {logs.slice(0, 20).map((log) => (
            <li key={log.id} className="flex items-start gap-3 rounded-xl border border-student-line p-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="rounded bg-student-gold-soft px-1.5 py-0.5 text-xs text-student-ink">{log.event_type}</code>
                  <StaffPill tone={log.severity === "critical" || log.severity === "error" ? "urgent" : log.severity === "warning" ? "attention" : "neutral"}>{sentence(log.severity)}</StaffPill>
                </div>
                <p className="mt-1 text-sm text-student-ink">{log.action_description}</p>
                <p className="mt-1 text-xs text-student-muted">
                  {new Date(log.created_at).toLocaleString()}
                  {log.actor_user_id && ` • Actor: ${log.actor_user_id.substring(0, 8)}...`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </StaffCard>
    </div>
  );
}

const TAB_TRIGGER =
  "min-h-11 gap-2 rounded-none rounded-t-lg border-b-2 border-transparent px-4 py-2 text-student-muted shadow-none hover:bg-student-gold-soft/50 hover:text-student-ink data-[state=active]:border-student-gold-ink data-[state=active]:bg-student-card data-[state=active]:text-student-ink data-[state=active]:shadow-none focus-visible:ring-student-gold-ink";

// Main Admin Dashboard
export default function Admin() {
  const [, setLocation] = useLocation();
  const search = useSearch();
  const selectedTab = adminTabFromSearch(search);
  return (
    <StaffPage>
      <StaffPageHeader
        eyebrow="Staff Portal · Administration"
        title="Lumière Administration"
        description="Accounts, programs, knowledge and audit trail."
      />

      <Link
        href="/admin/support-center"
        className="flex items-center justify-between gap-3 rounded-2xl border-2 border-student-gold-ink bg-student-gold-soft p-4 text-student-ink hover:bg-student-gold-soft/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink"
        data-testid="link-support-center"
      >
        <span className="flex min-w-0 items-center gap-3">
          <LifeBuoy className="h-6 w-6 shrink-0" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block font-serif text-lg">Control Center</span>
            <span className="block text-sm text-student-muted">Who needs help now: open cases, documents awaiting review, student files.</span>
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
              Overview
            </TabsTrigger>
            <TabsTrigger value="users" className={TAB_TRIGGER}>
              <Users className="h-4 w-4" aria-hidden="true" />
              Users
            </TabsTrigger>
            <TabsTrigger value="students" className={TAB_TRIGGER}>
              <GraduationCap className="h-4 w-4" aria-hidden="true" />
              Students
            </TabsTrigger>
            <TabsTrigger value="programs" className={TAB_TRIGGER}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Programs
            </TabsTrigger>
            <TabsTrigger value="knowledge" className={TAB_TRIGGER}>
              <BookOpen className="h-4 w-4" aria-hidden="true" />
              Knowledge
            </TabsTrigger>
            <TabsTrigger value="logs" className={TAB_TRIGGER}>
              <Activity className="h-4 w-4" aria-hidden="true" />
              Audit logs
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="overview" className="mt-0">
          <DashboardOverview />
        </TabsContent>

        <TabsContent value="users" className="mt-0">
          <UserManagement />
        </TabsContent>

        <TabsContent value="students" className="mt-0">
          <StudentManagement />
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
