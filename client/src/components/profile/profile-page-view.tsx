/**
 * Prop-driven student profile page (S09). Pages feed it a StudentProfileView;
 * mutations come from ProfileActionsContext, so it renders from fixtures with
 * no network.
 */
import React, { useEffect, useState } from "react";
import { Link } from "wouter";
import { AlertCircle, ChevronUp, CheckCircle2, ChevronRight, UserRound } from "lucide-react";
import type { ProfileReadinessItem, StudentProfileView } from "@shared/student-profile-contract";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { StudentSurface, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { PROFILE_SECTIONS, displayName, readinessChip, sectionDomId, splitReadiness, verificationChip } from "./profile-presentation";
import { StatusChip } from "./profile-ui";
import { IdentitySection } from "./identity-section";
import { ContactSection } from "./contact-section";
import { BackgroundSection } from "./background-section";
import { ContactsSection } from "./contacts-section";
import { EligibilitySection } from "./eligibility-section";
import { AccountSection } from "./account-section";

const sections = PROFILE_SECTIONS.map((s) => ({ id: sectionDomId(s.id), label: s.label }));

export function ProfileSectionNav() {
  const [active, setActive] = useState<string>(sections[0].id);
  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    const visible = new Map<string, number>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const e of entries) visible.set(e.target.id, e.isIntersecting ? e.intersectionRatio : 0);
        const best = [...visible.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActive(best[0]);
      },
      { rootMargin: "-20% 0px -60% 0px", threshold: [0, 0.1, 0.5, 1] },
    );
    sections.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);
  return (
    <nav
      aria-label="Profile sections"
      className="z-30 -mx-8 hidden min-w-0 border-b border-student-line bg-student-bg px-8 shadow-sm lg:sticky lg:top-0 lg:block"
      data-testid="section-nav"
    >
      <ul className="mx-auto flex max-w-6xl gap-1 overflow-x-auto py-1.5">
        {sections.map((s) => (
          <li key={s.id} className="shrink-0">
            <a
              href={`#${s.id}`}
              aria-current={active === s.id ? "location" : undefined}
              className={cn(
                "inline-flex min-h-[44px] items-center rounded-full px-3 text-sm font-medium",
                active === s.id
                  ? "border-2 border-student-gold-ink bg-student-gold-soft text-student-gold-ink"
                  : "border-2 border-transparent text-student-muted hover:text-student-ink",
              )}
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/** Mobile only: one compact floating "Jump to" menu. */
export function ProfileJumpMenu() {
  const [open, setOpen] = useState(false);
  return (
    <div className="student-surface fixed bottom-4 right-4 z-40 !bg-transparent lg:hidden" data-testid="jump-menu">
      {open && (
        <ul className="mb-2 overflow-hidden rounded-xl border border-student-line bg-student-card shadow-lg" aria-label="Jump to section">
          {sections.map((s) => (
            <li key={s.id}>
              <a
                href={`#${s.id}`}
                onClick={() => setOpen(false)}
                className="flex min-h-[44px] items-center px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft"
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="ml-auto flex min-h-[44px] items-center gap-2 rounded-full bg-student-seal px-4 text-sm font-semibold text-student-seal-ink shadow-lg"
      >
        Jump to
        <ChevronUp className={cn("h-4 w-4 transition-transform", !open && "rotate-180")} aria-hidden="true" />
      </button>
    </div>
  );
}

function ReadinessRow({ item }: { item: ProfileReadinessItem }) {
  const chip = readinessChip(item.kind);
  return (
    <li>
      <a
        href={`#${sectionDomId(item.section)}`}
        className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-student-gold-soft"
        data-testid="readiness-item"
        data-kind={item.kind}
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-student-ink">{item.label}</span>
          {item.detail && <span className="block text-xs text-student-muted">{item.detail}</span>}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <StatusChip label={chip.label} tone={chip.tone} />
          <ChevronRight className="h-4 w-4 text-student-muted" aria-hidden="true" />
        </span>
      </a>
    </li>
  );
}

export function ReadinessPanel({ items }: { items: readonly ProfileReadinessItem[] }) {
  const { attention, waiting } = splitReadiness(items);
  const clear = attention.length === 0 && waiting.length === 0;
  return (
    <section aria-labelledby="readiness-title" className={cn(cardClass, "space-y-4")} data-testid="readiness-panel">
      <div>
        <h2 id="readiness-title" className="font-serif text-xl text-student-ink">Your profile at a glance</h2>
        <p className="text-sm text-student-muted">Only things that need someone to act are listed. Optional details never appear here.</p>
      </div>
      {clear ? (
        <p className="flex items-center gap-2 text-sm font-medium text-student-gold-ink" data-testid="readiness-clear">
          <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
          Nothing needs your attention, and nothing is waiting on Lumière.
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          <div data-testid="readiness-attention">
            <h3 className="mb-1 text-sm font-semibold text-student-ink">Needs your attention</h3>
            {attention.length ? (
              <ul>{attention.map((i) => <ReadinessRow key={i.key} item={i} />)}</ul>
            ) : (
              <p className="px-3 text-sm text-student-muted">Nothing for you to do right now.</p>
            )}
          </div>
          <div data-testid="readiness-waiting">
            <h3 className="mb-1 text-sm font-semibold text-student-ink">Waiting on Lumière</h3>
            {waiting.length ? (
              <ul>{waiting.map((i) => <ReadinessRow key={i.key} item={i} />)}</ul>
            ) : (
              <p className="px-3 text-sm text-student-muted">Nothing is waiting for review.</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function ProfileHeader({ identity }: { identity: StudentProfileView["identity"] }) {
  const names = displayName(identity);
  const chip = verificationChip(identity.verification);
  return (
    <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center" data-testid="profile-header">
      <ProfileAvatarUpload photoUrl={identity.photoUrl} firstName={identity.firstName} lastName={identity.lastName} size="xl" />
      <div className="min-w-0 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-gold-ink">My profile</p>
        <h1 className="break-words font-serif text-3xl leading-tight tracking-tight text-student-ink sm:text-5xl" data-testid="text-profile-name">
          {names.primary}
        </h1>
        {names.legal !== names.primary && (
          <p className="text-sm text-student-muted" data-testid="text-legal-name">Legal name: {names.legal}</p>
        )}
        <p className="text-sm text-student-muted" data-testid="text-student-code">Student ID: {identity.studentCode}</p>
        <StatusChip label={`Identity: ${chip.label}`} tone={chip.tone} />
      </div>
    </header>
  );
}

export function ProfilePageView({ profile }: { profile: StudentProfileView }) {
  return (
    <StudentSurface testId="page-student-profile">
      <ProfileSectionNav />
      <div className="mx-auto max-w-6xl space-y-10 pt-6">
        <ProfileHeader identity={profile.identity} />
        <ReadinessPanel items={profile.readiness} />
        <IdentitySection identity={profile.identity} />
        <ContactSection contact={profile.contact} />
        <BackgroundSection background={profile.academicBackground} />
        <ContactsSection contacts={profile.contacts} />
        <EligibilitySection eligibility={profile.eligibility} />
        <AccountSection account={profile.account} email={profile.contact.email} />
      </div>
      <ProfileJumpMenu />
    </StudentSurface>
  );
}

// ---------------------------------------------------------------------------
// Page states
// ---------------------------------------------------------------------------

export function ProfileSkeleton() {
  return (
    <StudentSurface testId="profile-loading">
      <div className="mx-auto max-w-6xl space-y-6" role="status" aria-live="polite" aria-busy="true">
        <span className="sr-only">Loading your profile…</span>
        <div className="flex items-center gap-4">
          <Skeleton className="h-24 w-24 rounded-full" />
          <div className="space-y-2">
            <Skeleton className="h-9 w-64 max-w-full" />
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <Skeleton className="h-40 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </StudentSurface>
  );
}

export function ProfileErrorState({ onRetry }: { onRetry: () => void }) {
  return (
    <StudentSurface testId="profile-error">
      <div className="mx-auto max-w-md space-y-3 py-16 text-center" role="alert">
        <AlertCircle className="mx-auto h-10 w-10 text-student-attn" aria-hidden="true" />
        <h1 className="font-serif text-2xl text-student-ink">Student record could not be loaded</h1>
        <p className="text-sm text-student-muted">This is a system error, not a missing student record. Your information is safe.</p>
        <button type="button" className={buttonClass.solid} onClick={onRetry} data-testid="button-retry-profile">
          Try again
        </button>
      </div>
    </StudentSurface>
  );
}

export function ProfileNotReady() {
  return (
    <StudentSurface testId="profile-not-ready">
      <div className="mx-auto max-w-md space-y-3 py-16 text-center">
        <UserRound className="mx-auto h-10 w-10 text-student-muted" aria-hidden="true" />
        <h1 className="font-serif text-2xl text-student-ink">Student record not ready</h1>
        <p className="text-sm text-student-muted">Your Lumière advisor must create your student record before your profile can be shown.</p>
        <Link href="/support" className={buttonClass.outline}>Contact support</Link>
      </div>
    </StudentSurface>
  );
}
