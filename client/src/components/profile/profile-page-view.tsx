/**
 * Prop-driven student profile page (S09). Pages feed it a StudentProfileView;
 * mutations come from ProfileActionsContext, so it renders from fixtures with
 * no network.
 */
import React from "react";
import { Link } from "wouter";
import { AlertCircle, CheckCircle2, ChevronRight, UserRound } from "lucide-react";
import type { ProfileReadinessItem, StudentProfileView } from "@shared/student-profile-contract";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Eyebrow, StudentSurface, buttonClass, cardClass } from "@/components/student-progress/student-ui";
import { ProfileAvatarUpload } from "@/components/profile-avatar-upload";
import { PROFILE_SECTIONS, displayName, readinessAction, readinessChip, sectionDomId, splitReadiness, verificationChip } from "./profile-presentation";
import { StatusChip } from "./profile-ui";
import { useProfileActions } from "./profile-actions";
import { IdentitySection } from "./identity-section";
import { ContactSection } from "./contact-section";
import { BackgroundSection } from "./background-section";
import { ContactsSection } from "./contacts-section";
import { EligibilitySection } from "./eligibility-section";
import { AccountSection } from "./account-section";

const sections = PROFILE_SECTIONS.map((s) => ({ id: sectionDomId(s.id), label: s.label }));

/**
 * The one in-page navigation: short pills under the header (same order as Roadmap:
 * header first, then navigation). Pills wrap on small screens so none is cut off.
 */
export function ProfileSectionNav() {
  return (
    <nav aria-label="Profile sections" className="min-w-0" data-testid="section-nav">
      <ul className="flex flex-wrap gap-2">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="inline-flex min-h-[44px] items-center rounded-full border border-student-line-strong bg-student-card px-4 text-sm font-medium text-student-ink hover:bg-student-gold-soft"
            >
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function ReadinessRow({ item }: { item: ProfileReadinessItem }) {
  const chip = readinessChip(item.kind);
  const action = readinessAction(item);
  const body = (
    <span className="min-w-0">
      <span className="block text-sm font-medium text-student-ink">{item.label}</span>
      {item.detail && <span className="block text-xs text-student-muted">{item.detail}</span>}
    </span>
  );
  if (!action) {
    return (
      <li>
        <a
          href={`#${sectionDomId(item.section)}`}
          className="flex min-h-[44px] items-center justify-between gap-3 rounded-lg px-3 py-2 hover:bg-student-gold-soft"
          data-testid="readiness-item"
          data-kind={item.kind}
        >
          {body}
          <span className="flex shrink-0 items-center gap-2">
            <StatusChip label={chip.label} tone={chip.tone} />
            <ChevronRight className="h-4 w-4 text-student-muted" aria-hidden="true" />
          </span>
        </a>
      </li>
    );
  }
  // Missing or action-required: a weighted row with its own action button.
  return (
    <li className="rounded-lg border border-st-attention bg-student-attn-soft" data-testid="readiness-item" data-kind={item.kind}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-3 py-2.5">
        {body}
        <span className="flex shrink-0 flex-wrap items-center gap-2">
          <StatusChip label={chip.label} tone={chip.tone} />
          {action.external ? (
            <Link href={action.href} className={buttonClass.solid} data-testid="readiness-action">{action.label}</Link>
          ) : (
            <a href={action.href} className={buttonClass.solid} data-testid="readiness-action">{action.label}</a>
          )}
        </span>
      </div>
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
  const actions = useProfileActions();
  return (
    <header className="flex flex-col items-start gap-4 sm:flex-row sm:items-center" data-testid="profile-header">
      <ProfileAvatarUpload
        photoUrl={identity.photoUrl}
        firstName={identity.firstName}
        lastName={identity.lastName}
        studentId={identity.studentId}
        onUploadSuccess={() => actions.refresh()}
        size="xl"
        showUploadButton
      />
      <div className="min-w-0 space-y-1">
        <Eyebrow>My profile</Eyebrow>
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
      <div className="mx-auto max-w-6xl space-y-6 pb-6 pt-2 sm:space-y-8 sm:pt-4">
        <ProfileHeader identity={profile.identity} />
        <ProfileSectionNav />
        <ReadinessPanel items={profile.readiness} />
        <IdentitySection identity={profile.identity} />
        <ContactSection contact={profile.contact} />
        <BackgroundSection background={profile.academicBackground} />
        <ContactsSection contacts={profile.contacts} />
        <EligibilitySection eligibility={profile.eligibility} />
        <AccountSection account={profile.account} email={profile.contact.email} />
      </div>
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
