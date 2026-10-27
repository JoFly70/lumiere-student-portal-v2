/** Loading, error, no-enrollment and no-roadmap states for the High School Pathway page. */
import React from "react";
import { Link } from "wouter";
import { AlertCircle, GraduationCap, RefreshCw, Sprout } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Eyebrow, buttonClass, cardClass } from "@/components/student-progress/student-ui";

export function HsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6" role="status" aria-label="Loading your high school journey" data-testid="hs-skeleton">
      <div className="space-y-3">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-10 w-3/4 max-w-md" />
        <Skeleton className="h-4 w-64" />
      </div>
      <Skeleton className="h-12 rounded-xl" />
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-64 rounded-2xl lg:col-span-3" />
        <Skeleton className="h-64 rounded-2xl lg:col-span-2" />
      </div>
      <Skeleton className="h-40 rounded-2xl" />
    </div>
  );
}

export function HsError({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="hs-error">
      <div className={`${cardClass} space-y-4 border-st-attention`} role="alert">
        <AlertCircle className="h-6 w-6 text-st-attention" aria-hidden="true" />
        <h2 className="font-serif text-2xl tracking-tight text-student-ink">We could not load your high school journey</h2>
        <p className="text-sm leading-relaxed text-student-muted">
          This is usually a brief connection problem. Nothing on your record has changed.{message ? ` (${message})` : ""}
        </p>
        {onRetry && (
          <button type="button" className={buttonClass.outline} onClick={onRetry} data-testid="button-retry">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Try again
          </button>
        )}
      </div>
    </div>
  );
}

export function HsNoEnrollment() {
  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="hs-no-enrollment">
      <div className={`${cardClass} space-y-4`}>
        <Eyebrow>High school pathway</Eyebrow>
        <Sprout className="h-7 w-7 text-student-gold-ink" aria-hidden="true" />
        <h1 className="font-serif text-3xl tracking-tight text-student-ink">Your high school plan isn&apos;t set up yet</h1>
        <p className="text-base leading-relaxed text-student-muted">
          Lumière is still getting your high school pathway ready with you. Once it is set up, your courses, credits and next steps will appear here.
        </p>
        <Link href="/support" className={buttonClass.primary} data-testid="link-support">
          Ask Lumière about your plan
        </Link>
      </div>
    </div>
  );
}

export function HsNoRoadmap() {
  return (
    <div className={`${cardClass} space-y-3`} data-testid="hs-no-roadmap">
      <GraduationCap className="h-6 w-6 text-student-gold-ink" aria-hidden="true" />
      <h2 className="font-serif text-2xl tracking-tight text-student-ink">Your roadmap is being prepared</h2>
      <p className="max-w-2xl text-sm leading-relaxed text-student-muted">
        Your enrollment is set up, but Lumière has not published your plan yet. When it is ready, your courses, targets and next steps will show up here. You do not need to do anything.
      </p>
      <Link href="/support" className={buttonClass.outline}>
        Questions? Contact Support
      </Link>
    </div>
  );
}
