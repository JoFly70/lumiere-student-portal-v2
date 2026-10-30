/**
 * Direct WhatsApp contact with Lumière (official number). A plain wa.me link: no API, no tracking, and no student
 * data in the URL. Conversations happen in WhatsApp, outside the portal's support requests.
 */
import React from "react";
import { SiWhatsapp } from "react-icons/si";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

export const LUMIERE_WHATSAPP_URL = "https://wa.me/19453917325";
export const LUMIERE_WHATSAPP_DISPLAY = "+1 945 391 7325";

/** Shared external-link attributes: new tab, no opener, no referrer. */
export const whatsappLinkProps = {
  href: LUMIERE_WHATSAPP_URL,
  target: "_blank",
  rel: "noopener noreferrer",
} as const;

/** Support page card: explanatory line and the call-to-action button. */
export function WhatsAppContactCard({ className }: { className?: string }) {
  const { t } = useT();
  return (
    <section
      aria-labelledby="whatsapp-contact-title"
      className={cn(
        "flex flex-col gap-4 rounded-2xl border border-student-line bg-student-card p-5 shadow-[0_1px_2px_hsl(var(--s-ink)/0.04),0_8px_24px_-14px_hsl(var(--s-ink)/0.12)] sm:flex-row sm:items-center sm:justify-between",
        className,
      )}
      data-testid="whatsapp-contact"
    >
      <div className="flex min-w-0 items-start gap-4">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[#25D366]/12 text-[#128C4B] ring-1 ring-[#25D366]/30" aria-hidden="true">
          <SiWhatsapp className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h2 id="whatsapp-contact-title" className="font-serif text-xl tracking-tight text-student-ink">{t("support.whatsapp.title")}</h2>
          <p className="mt-1 text-sm leading-relaxed text-student-muted">{t("support.whatsapp.text")}</p>
          <p className="mt-1 text-xs text-student-muted">{t("support.whatsapp.note")}</p>
        </div>
      </div>
      <a
        {...whatsappLinkProps}
        aria-label={`${t("support.whatsapp.cta")} (${t("support.whatsapp.newTab")})`}
        className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg bg-[#167A40] px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-[#11663A] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-student-gold-ink"
        data-testid="link-whatsapp-support"
      >
        <SiWhatsapp className="h-4 w-4" aria-hidden="true" />
        {t("support.whatsapp.cta")}
      </a>
    </section>
  );
}
