/** Loading, error and not-ready states shared by the student progress pages. */
import React from "react";
import { Link } from "wouter";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";

export function ProgressSkeleton() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10"
      role="status"
      aria-label="Loading your academic progress"
      data-testid="progress-skeleton"
    >
      <div className="space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-3/4 max-w-lg" />
        <Skeleton className="h-4 w-64" />
      </div>
      <div className="grid gap-6 lg:grid-cols-5">
        <Skeleton className="h-72 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-72 rounded-2xl lg:col-span-3" />
      </div>
      <Skeleton className="h-28 rounded-2xl" />
    </div>
  );
}

export function ProgressError({
  message,
  onRetry,
}: {
  message?: string;
  onRetry?: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" data-testid="error-state">
      <div
        className="space-y-4 rounded-2xl border border-destructive/40 bg-card p-6 sm:p-8"
        role="alert"
      >
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h2 className="font-serif text-2xl tracking-tight">We could not load your progress</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          This is usually a brief connection problem. Your academic record has not been changed.
          {message ? ` (${message})` : ""}
        </p>
        {onRetry && (
          <Button
            variant="outline"
            onClick={onRetry}
            className="min-h-[44px]"
            data-testid="button-retry"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            Try again
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlanNotReady() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" data-testid="flight-deck-incomplete-state">
      <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gold-strong">
          Almost there
        </p>
        <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">
          Your Lumi&egrave;re plan is not ready yet
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Your advisor must create your student record before your academic progress can be shown.
          This page checks again automatically, so it will update as soon as your record exists.
        </p>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href="/support">Contact Support</Link>
        </Button>
      </div>
    </div>
  );
}
