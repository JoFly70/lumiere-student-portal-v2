/** Loading, error, no-enrollment and no-roadmap states for the High School Pathway page. */
import React from "react";
import { Link } from "wouter";
import { AlertCircle, GraduationCap, RefreshCw, Sprout } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useT } from "@/i18n";
import { Eyebrow, buttonClass, cardClass } from "@/components/student-progress/student-ui";

export function HsSkeleton() {
  const { t } = useT();
  return (
    <div className="mx-auto w-full max-w-6xl space-y-6" role="status" aria-label={t("hs.loading")} data-testid="hs-skeleton">
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
  const { t } = useT();
  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="hs-error">
      <div className={`${cardClass} space-y-4 border-st-attention`} role="alert">
        <AlertCircle className="h-6 w-6 text-st-attention" aria-hidden="true" />
        <h2 className="font-serif text-2xl tracking-tight text-student-ink">{t("hs.error.title")}</h2>
        <p className="text-sm leading-relaxed text-student-muted">
          {t("hs.error.body")}{message ? ` (${message})` : ""}
        </p>
        {onRetry && (
          <button type="button" className={buttonClass.outline} onClick={onRetry} data-testid="button-retry">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            {t("hs.error.retry")}
          </button>
        )}
      </div>
    </div>
  );
}

export function HsNoEnrollment() {
  const { t } = useT();
  return (
    <div className="mx-auto w-full max-w-2xl" data-testid="hs-no-enrollment">
      <div className={`${cardClass} space-y-4`}>
        <Eyebrow>{t("hs.noEnrollment.eyebrow")}</Eyebrow>
        <Sprout className="h-7 w-7 text-student-gold-ink" aria-hidden="true" />
        <h1 className="font-serif text-3xl tracking-tight text-student-ink">{t("hs.noEnrollment.title")}</h1>
        <p className="text-base leading-relaxed text-student-muted">
          {t("hs.noEnrollment.body")}
        </p>
        <Link href="/support" className={buttonClass.primary} data-testid="link-support">
          {t("hs.noEnrollment.cta")}
        </Link>
      </div>
    </div>
  );
}

export function HsNoRoadmap() {
  const { t } = useT();
  return (
    <div className={`${cardClass} space-y-3`} data-testid="hs-no-roadmap">
      <GraduationCap className="h-6 w-6 text-student-gold-ink" aria-hidden="true" />
      <h2 className="font-serif text-2xl tracking-tight text-student-ink">{t("hs.noRoadmap.title")}</h2>
      <p className="max-w-2xl text-sm leading-relaxed text-student-muted">
        {t("hs.noRoadmap.body")}
      </p>
      <Link href="/support" className={buttonClass.outline}>
        {t("hs.noRoadmap.cta")}
      </Link>
    </div>
  );
}
