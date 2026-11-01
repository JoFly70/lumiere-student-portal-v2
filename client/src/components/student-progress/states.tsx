/** Loading, error and not-ready states shared by the student progress pages. */
import React from "react";
import { Link } from "wouter";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";

export function ProgressSkeleton() {
  const { t } = useT();
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-8 px-4 py-6 sm:px-6 sm:py-10"
      role="status"
      aria-label={t("s32.state.loadingAria")}
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

/** The raw error text is never shown to the student (it is English and can be technical). */
export function ProgressError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useT();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" data-testid="error-state">
      <div
        className="space-y-4 rounded-2xl border border-destructive/40 bg-card p-6 sm:p-8"
        role="alert"
      >
        <AlertCircle className="h-6 w-6 text-destructive" aria-hidden="true" />
        <h2 className="font-serif text-2xl tracking-tight">{t("s32.state.error.title")}</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("s32.state.error.body")}
        </p>
        {onRetry && (
          <Button
            variant="outline"
            onClick={onRetry}
            className="min-h-[44px]"
            data-testid="button-retry"
          >
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />
            {t("s32.state.retry")}
          </Button>
        )}
      </div>
    </div>
  );
}

export function PlanNotReady() {
  const { t } = useT();
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6" data-testid="flight-deck-incomplete-state">
      <div className="space-y-4 rounded-2xl border border-card-border bg-card p-6 shadow-sm sm:p-8">
        <p className="text-xs font-medium uppercase tracking-[0.14em] text-gold-strong">
          {t("s32.state.notReady.eyebrow")}
        </p>
        <h2 className="font-serif text-2xl tracking-tight sm:text-3xl">
          {t("s32.state.notReady.title")}
        </h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          {t("s32.state.notReady.body")}
        </p>
        <Button asChild variant="outline" className="min-h-[44px]">
          <Link href="/support">{t("s32.state.notReady.cta")}</Link>
        </Button>
      </div>
    </div>
  );
}
