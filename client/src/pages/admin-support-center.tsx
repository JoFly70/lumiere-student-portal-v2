import React from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  BookOpenCheck,
  ClipboardList,
  CreditCard,
  FileText,
  GraduationCap,
  Headphones,
  Map,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  StaffCard,
  StaffPage,
  StaffPageHeader,
  StaffSectionHeader,
  staffBtn,
} from "@/components/staff/staff-ui";

const STUDENTS_PATH = "/admin?tab=students";
const SUPPORT_PATH = "/support";

const workspaceCapabilities = [
  {
    title: "Profile",
    description: "Review the student's identity and core record.",
    icon: UserRound,
  },
  {
    title: "Progress",
    description: "See academic progress in the context of the full record.",
    icon: BookOpenCheck,
  },
  {
    title: "Roadmap",
    description: "Follow the student's academic plan and next steps.",
    icon: Map,
  },
  {
    title: "High-school pathway",
    description: "Review high-school planning information.",
    icon: GraduationCap,
  },
  {
    title: "Documents and evidence",
    description: "Find the supporting materials attached to the record.",
    icon: FileText,
  },
  {
    title: "Tickets",
    description: "See student support history alongside their academic context.",
    icon: ClipboardList,
  },
  {
    title: "Billing",
    description: "Review billing information from the student workspace.",
    icon: CreditCard,
  },
  {
    title: "Read-only student preview",
    description: "Understand the student's view without changing their account.",
    icon: ShieldCheck,
  },
];

function DestinationLink({
  href,
  eyebrow,
  title,
  description,
  icon: Icon,
  action,
  tone = "default",
}: {
  href: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof UsersRound;
  action: string;
  tone?: "default" | "gold";
}) {
  return (
    <Link
      href={href}
      className={`group flex h-full flex-col rounded-2xl border p-5 transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_12px_30px_-20px_hsl(var(--s-ink)/0.35)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink sm:p-6 ${
        tone === "gold"
          ? "border-student-gold bg-student-gold-soft/70"
          : "border-student-line bg-student-card"
      }`}
    >
      <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-xl border border-student-line bg-student-card text-student-gold-ink">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-student-muted">
        {eyebrow}
      </span>
      <span className="mt-1 font-serif text-2xl tracking-tight text-student-ink">
        {title}
      </span>
      <span className="mt-2 max-w-md text-sm leading-relaxed text-student-muted">
        {description}
      </span>
      <span className="mt-6 inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-student-gold-ink">
        {action}
        <ArrowRight
          className="h-4 w-4 transition-transform group-hover:translate-x-1"
          aria-hidden="true"
        />
      </span>
    </Link>
  );
}

export default function AdminSupportCenter() {
  return (
    <StaffPage width="wide" className="pb-8" testId="admin-support-center">
      <StaffPageHeader
        eyebrow="Lumière · Admin support center"
        title="Student Support Control Center"
        description="Start with the student's academic record, then resolve their support request with the right context close at hand."
        meta={
          <span className="inline-flex items-center gap-2 text-xs font-medium text-student-muted">
            <span className="h-1.5 w-1.5 rounded-full bg-student-gold-ink" aria-hidden="true" />
            Admin navigation
          </span>
        }
      />

      <section aria-labelledby="start-here-heading" className="space-y-4">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-student-gold-ink">
              Start here
            </p>
            <h2
              id="start-here-heading"
              className="mt-1 font-serif text-xl tracking-tight text-student-ink sm:text-2xl"
            >
              Choose the right workspace
            </h2>
          </div>
          <p className="max-w-md text-sm leading-relaxed text-student-muted">
            Both destinations are existing work areas. No new records or workflows start here.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <DestinationLink
            href={STUDENTS_PATH}
            eyebrow="01 · Academic context"
            title="Find a student"
            description="Open the student directory to locate a student and enter their complete academic workspace."
            icon={UsersRound}
            action="Go to student directory"
            tone="gold"
          />
          <DestinationLink
            href={SUPPORT_PATH}
            eyebrow="02 · Request resolution"
            title="Work a support request"
            description="Open the support desk to review and resolve student requests in its existing queue."
            icon={Headphones}
            action="Go to support desk"
          />
        </div>
      </section>

      <StaffCard className="overflow-hidden p-0">
        <div className="grid lg:grid-cols-[0.82fr_1.18fr]">
          <div className="border-b border-student-line bg-student-gold-soft/40 p-5 sm:p-7 lg:border-b-0 lg:border-r">
            <StaffSectionHeader
              title="The student workspace"
              description="Open a student from the directory to move between their record and support context without hunting across separate admin areas."
              icon={<GraduationCap className="h-5 w-5" />}
            />
            <div className="mt-6 border-l-2 border-student-gold pl-4">
              <p className="font-serif text-lg leading-snug text-student-ink">
                One record, multiple useful views.
              </p>
              <p className="mt-1 text-sm leading-relaxed text-student-muted">
                The directory is the entry point. The existing workspace holds the student's related academic and service information.
              </p>
            </div>
            <Button
              asChild
              variant="outline"
              className={`${staffBtn.outline} mt-6`}
            >
              <Link href={STUDENTS_PATH}>
                Browse students
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </div>

          <div className="p-5 sm:p-7">
            <h3 className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-student-muted">
              Available from the directory
            </h3>
            <ul className="grid gap-x-6 sm:grid-cols-2">
              {workspaceCapabilities.map(({ title, description, icon: Icon }) => (
                <li
                  key={title}
                  className="flex gap-3 border-t border-student-line py-3.5 first:border-t-0 sm:[&:nth-child(2)]:border-t-0"
                >
                  <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-student-gold-soft text-student-gold-ink">
                    <Icon className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-student-ink">{title}</p>
                    <p className="mt-0.5 text-xs leading-relaxed text-student-muted">
                      {description}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </StaffCard>

      <footer className="flex flex-col gap-3 rounded-xl border border-student-line bg-student-card/70 px-4 py-3 text-sm text-student-muted sm:flex-row sm:items-center sm:justify-between">
        <p>
          Keep the student's record in view while addressing the request.
        </p>
        <Link
          href={SUPPORT_PATH}
          className="inline-flex min-h-10 items-center gap-2 font-semibold text-student-gold-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink"
        >
          Open support desk
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      </footer>
    </StaffPage>
  );
}
