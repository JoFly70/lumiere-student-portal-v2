import { Link } from "wouter";
import { Compass } from "lucide-react";
import { useT } from "@/i18n";
import { buttonClass } from "@/components/student-progress/student-ui";
import { cn } from "@/lib/utils";

/** 404: ivory canvas, serif title, gold primary link. Sits inside the app shell (student or staff). */
export default function NotFound() {
  const { t } = useT();
  return (
    <div className="flex min-h-[60vh] w-full items-center justify-center px-4 py-12" data-testid="page-not-found">
      <div className="w-full max-w-md rounded-2xl border border-student-line bg-student-card p-8 text-center shadow-sm">
        <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full border border-student-gold bg-student-gold-soft text-student-gold-ink">
          <Compass className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="font-serif text-3xl tracking-tight text-student-ink">{t("common.notFound.title")}</h1>
        <p className="mt-3 text-sm leading-relaxed text-student-muted">{t("common.notFound.body")}</p>
        <Link href="/" className={cn(buttonClass.primary, "mt-6 no-underline")}>{t("common.notFound.home")}</Link>
      </div>
    </div>
  );
}
