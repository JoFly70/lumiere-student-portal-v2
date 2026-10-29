/**
 * S27 Student file (/admin/students/:studentId). Header (portrait, name, code, program, status pills, actions) and
 * tabs driven by `?tab=`: Overview, Roadmap (diploma) or Degree plan (degree), Documents, Billing, Notes & timeline,
 * Sessions. The earlier all-in-one academic workspace (placements, guardian & identity, support, activity, AI) stays
 * available at /admin/students/:studentId/workspace.
 */
import React, { useMemo } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Eye, Loader2, MessageSquare, UserCheck, Wrench } from "lucide-react";
import { StaffEmpty, StaffNotice, StaffPage, StaffPill, StaffTabList, StaffTabPanel, staffBtn, type StaffTab } from "@/components/staff/staff-ui";
import { AccountAvatar } from "@/components/os/account-menu";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT, type TranslationKey } from "@/i18n";
import { useDocuments } from "@/hooks/use-documents";
import { useHsState } from "@/lib/admin-high-school-api";
import { useStaffBilling } from "@/lib/billing-queries";
import { useStaffProfileData } from "@/components/admin/student-profile-review";
import { StudentDocumentsReview } from "@/components/admin/student-documents-review";
import { useExperienceAction, ExperienceError } from "@/components/admin/dossier/dossier-parts";
import { DemoPill, isDemoStudent, shortProgram, studentFullName, studentStatusLabel } from "@/components/admin/directory/directory-data";
import { canActivateLeadForRole } from "@/components/admin/student-documents-upload-logic";
import { ADMIN_STUDENT_WORKSPACE_QUERY_KEY, ADMIN_STUDENTS_PATH, documentNeedsReview, selectWorkspaceState, type WorkspaceViewModel } from "@/pages/admin-student-workspace-presentation";
import { useAgreement, useStaffJourney } from "@/lib/s27-queries";
import { creditsBySource } from "@/lib/file-decisions";
import { academicCreditRows } from "@/pages/admin-student-workspace-presentation";
import { fileTabFromSearch, fileTabsFor, type FileTab, type ProgramKind } from "@/lib/owner-presentation";
import { cn } from "@/lib/utils";
import { ownerBtn } from "@/components/admin/control/owner-ui";
import { OverviewTab } from "./overview-tab";
import { RoadmapTab } from "./roadmap-tab";
import { DegreePlanTab } from "./degree-plan-tab";
import { BillingTab } from "./billing-tab";
import { NotesTab } from "./notes-tab";
import { SessionsTab } from "./sessions-tab";
import { Panel } from "./file-parts";
import type { StudentFileRecord } from "@/components/admin/student-file-hs";

const TAB_LABEL: Record<FileTab, TranslationKey> = {
  overview: "owner.tab.overview", roadmap: "owner.tab.roadmap", plan: "owner.tab.plan", documents: "owner.tab.documents", billing: "owner.tab.billing", notes: "owner.tab.notes", sessions: "owner.tab.sessions",
};

export function StudentFile({ studentId }: { studentId: string }) {
  const { t } = useT();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const search = useSearch();
  const [location, navigate] = useLocation();
  const qc = useQueryClient();

  const student = useQuery<StudentFileRecord & { photo_url?: string | null }>({
    queryKey: [`/api/students/${encodeURIComponent(studentId)}`],
    queryFn: () => apiRequest(`/api/students/${encodeURIComponent(studentId)}`),
    enabled: !!studentId,
    retry: false,
  });
  const hsQuery = useHsState(studentId);
  const workspaceQuery = useQuery({
    queryKey: ADMIN_STUDENT_WORKSPACE_QUERY_KEY(studentId),
    queryFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/workspace`),
    enabled: !!studentId,
    retry: false,
    staleTime: 30_000,
  });
  const documents = useDocuments(studentId);
  const billing = useStaffBilling(studentId);
  const { profileQuery } = useStaffProfileData(studentId);
  const journey = useStaffJourney(studentId);
  const agreement = useAgreement(studentId);
  const experience = useExperienceAction(studentId);

  const hs = hsQuery.data ?? null;
  const ws = selectWorkspaceState(workspaceQuery);
  const vm: WorkspaceViewModel | null = ws.kind === "ready" ? ws.viewModel : null;
  const kind: ProgramKind = hs?.current ? "diploma" : vm ? "degree" : "none";
  const settled = !hsQuery.isLoading && !workspaceQuery.isLoading;
  const tab = fileTabFromSearch(search, kind);
  const params = new URLSearchParams(search);

  const activate = useMutation({
    mutationFn: () => apiRequest(`/api/admin/students/${encodeURIComponent(studentId)}/status`, { method: "PATCH", body: JSON.stringify({ status: "active" }) }),
    onSuccess: () => qc.invalidateQueries({ queryKey: [`/api/students/${encodeURIComponent(studentId)}`] }),
  });

  const go = (next: FileTab, extra?: Record<string, string>) => {
    const q = new URLSearchParams({ tab: next, ...(extra ?? {}) });
    navigate(`${location.split("?")[0]}?${q.toString()}`, { replace: true });
  };

  const docsPending = (documents.data ?? []).filter((d) => documentNeedsReview(d.status)).length;
  const evidenceWaiting = billing.data?.evidence.filter((e) => e.status === "awaiting_review").length ?? 0;
  const sessionsRequested = journey.data?.sessions.filter((s) => s.status === "requested").length ?? 0;
  const degreeCredits = useMemo(() => (vm ? creditsBySource(academicCreditRows(vm.academicDetail) as never).reduce((a, s) => a + s.accepted, 0) : null), [vm]);

  if (student.isLoading) return <StaffPage><div role="status" className="space-y-4"><span className="sr-only">{t("owner.loading")}</span><div className="h-24 animate-pulse rounded-2xl bg-student-line" /><div className="h-64 animate-pulse rounded-2xl bg-student-line" /></div></StaffPage>;
  if (student.isError || !student.data) {
    return <StaffPage><StaffEmpty title={t("owner.file.notFound.title")} testId="file-not-found" action={<Link href={ADMIN_STUDENTS_PATH} className={cn(ownerBtn.outline, "border")}>{t("owner.file.back")}</Link>}>{t("owner.file.notFound.body")}</StaffEmpty></StaffPage>;
  }

  const s = student.data;
  const name = studentFullName({ first_name: s.first_name ?? "", last_name: s.last_name ?? "", preferred_name: s.preferred_name });
  const demo = isDemoStudent({ first_name: s.first_name ?? "", last_name: s.last_name ?? "", preferred_name: s.preferred_name, email: s.email });
  const firstName = (s.preferred_name && !/^DEMO/i.test(s.preferred_name) ? s.preferred_name : s.first_name) ?? name;
  const programName = hs?.current ? shortProgram(hs.current.enrollment.programTitle) : vm ? (typeof (vm.program as { name?: unknown } | undefined)?.name === "string" ? shortProgram(String((vm.program as { name: string }).name)) : t("owner.program.bachelor")) : null;
  const supportLeft = agreement.data?.supportMonthsLeft ?? journey.data?.agreement?.supportMonthsLeft ?? null;
  const guardians = profileQuery.data?.contacts.some((c) => c.type === "guardian" || c.type === "parent") || (hs?.guardians.length ?? 0) > 0;
  const credits = hs?.current && !/credits/i.test(programName ?? "") ? `${hs.current.credits.requiredHalfUnits / 2} ${t("owner.file.credits")}` : null;
  const canActivate = canActivateLeadForRole(user?.role, (s.status ?? "").toLowerCase());
  const base = `/admin/students/${encodeURIComponent(studentId)}`;

  const tabs: StaffTab[] = fileTabsFor(kind).map((k) => ({
    key: k, label: t(TAB_LABEL[k]),
    count: k === "documents" ? docsPending : k === "billing" ? evidenceWaiting : k === "sessions" ? sessionsRequested : k === "roadmap" ? hs?.current?.reviewQueue.length ?? 0 : 0,
    countLabel: t("owner.tab.needsAttention"),
  }));

  return (
    <StaffPage width="wide" testId="admin-student-file">
      <header className="space-y-4 border-b border-student-line pb-5" data-testid="student-file-header">
        <Link href={ADMIN_STUDENTS_PATH} className="inline-flex min-h-10 items-center gap-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline"><ArrowLeft className="h-4 w-4" aria-hidden="true" />{t("owner.file.back")}</Link>
        <div className="flex min-w-0 flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <AccountAvatar identity={{ studentId, firstName: profileQuery.data?.identity.firstName ?? s.first_name, lastName: profileQuery.data?.identity.lastName ?? s.last_name, name, email: s.email, photoUrl: profileQuery.data?.identity.photoUrl }} className="h-16 w-16 shrink-0 text-xl ring-2 ring-student-gold/60 ring-offset-2 ring-offset-student-bg sm:h-20 sm:w-20 sm:text-2xl" />
            <div className="min-w-0 space-y-1.5">
              <p className="flex items-center gap-3 text-[11px] font-semibold uppercase tracking-[0.18em] text-student-gold-ink"><span aria-hidden="true" className="h-px w-6 bg-student-gold" />{t("owner.file.eyebrow")}</p>
              <h1 className="font-serif text-3xl leading-tight tracking-tight text-student-ink [overflow-wrap:anywhere] sm:text-4xl" data-testid="text-page-title">{name}</h1>
              <p className="break-words text-sm text-student-muted"><span className="font-mono">{s.student_code ?? t("owner.file.noCode")}</span>{programName ? ` · ${programName}` : ` · ${t("owner.file.noProgram")}`}{credits ? ` · ${credits}` : ""}{guardians ? ` · ${t("owner.file.guardian")}` : ""}</p>
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <StaffPill tone="seal">{studentStatusLabel((s.status ?? "").toLowerCase())}</StaffPill>
                {demo ? <DemoPill /> : null}
                {kind !== "none" ? <StaffPill tone="neutral">{t(kind === "diploma" ? "owner.program.diploma" : "owner.program.bachelor")}</StaffPill> : null}
                {supportLeft !== null ? <StaffPill tone="neutral">{t(supportLeft === 1 ? "owner.file.supportLeft.one" : "owner.file.supportLeft.other", { n: supportLeft })}</StaffPill> : null}
              </div>
            </div>
          </div>
          <div role="toolbar" aria-label={t("owner.file.actions")} className="flex flex-wrap items-center gap-2" data-testid="file-actions">
            {isAdmin ? (
              <button type="button" className={cn(ownerBtn.seal, "min-h-10")} onClick={() => void experience.run()} disabled={experience.pending} data-testid="button-view-as-student">
                {experience.pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Eye className="h-4 w-4" aria-hidden="true" />}{t("owner.file.viewAs")}
              </button>
            ) : null}
            <Link href={`/support?search=${encodeURIComponent(s.student_code ?? name)}`} className={cn(ownerBtn.outline, "inline-flex items-center border")} data-testid="button-message"><MessageSquare className="h-4 w-4" aria-hidden="true" />{t("owner.file.message")}</Link>
            {canActivate ? <button type="button" className={ownerBtn.outline} disabled={activate.isPending} onClick={() => activate.mutate()} data-testid="button-activate-lead"><UserCheck className="h-4 w-4" aria-hidden="true" />{activate.isPending ? t("owner.saving") : t("owner.file.activate")}</button> : null}
            {isAdmin ? <Link href={`${base}/workspace`} className={cn(ownerBtn.ghost, "inline-flex items-center")} data-testid="link-workspace"><Wrench className="h-4 w-4" aria-hidden="true" />{t("owner.file.workspace")}</Link> : null}
          </div>
        </div>
      </header>
      <ExperienceError action={experience} />
      {activate.isError ? <StaffNotice tone="urgent" role="alert">{activate.error instanceof Error ? activate.error.message : t("owner.file.activateError")}</StaffNotice> : null}
      {demo ? <StaffNotice tone="attention" role="status">{t("owner.file.demoNote")}</StaffNotice> : null}

      <StaffTabList tabs={tabs} active={tab} onChange={(k) => go(k as FileTab)} label={t("owner.file.tabs")} idPrefix="sf" />

      {!settled ? <div role="status" className="h-48 animate-pulse rounded-2xl bg-student-line"><span className="sr-only">{t("owner.loading")}</span></div> : (
        <>
          <StaffTabPanel idPrefix="sf" tabKey="overview" active={tab === "overview"}>
            {tab === "overview" ? <OverviewTab studentId={studentId} studentLabel={firstName} kind={kind} isAdmin={isAdmin} hs={hs} degreeCreditsConfirmed={degreeCredits} documentsPending={docsPending} billing={billing.data} journey={journey} agreement={agreement} go={go} /> : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="roadmap" active={tab === "roadmap"}>
            {tab === "roadmap" && hs ? <RoadmapTab studentId={studentId} state={hs} docs={documents.data ?? []} isAdmin={isAdmin} recordKey={params.get("record")} go={go} /> : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="plan" active={tab === "plan"}>
            {tab === "plan" ? <DegreePlanTab studentId={studentId} vm={vm} /> : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="documents" active={tab === "documents"}>
            {tab === "documents" ? (
              <div className="space-y-6" data-testid="documents-tab">
                <Panel id="doc-title" title={t("owner.docs.title")} description={t("owner.docs.aside")}>
                  <StudentDocumentsReview studentId={studentId} documents={documents.data ?? []} />
                </Panel>
              </div>
            ) : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="billing" active={tab === "billing"}>
            {tab === "billing" ? <BillingTab studentId={studentId} personName={firstName} documents={documents.data ?? []} /> : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="notes" active={tab === "notes"}>
            {tab === "notes" ? <NotesTab studentId={studentId} hs={hs} isAdmin={isAdmin} /> : null}
          </StaffTabPanel>
          <StaffTabPanel idPrefix="sf" tabKey="sessions" active={tab === "sessions"}>
            {tab === "sessions" ? <SessionsTab studentId={studentId} /> : null}
          </StaffTabPanel>
        </>
      )}
    </StaffPage>
  );
}
