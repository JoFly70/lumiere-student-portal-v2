/**
 * Billing history (S32-B): the ledger-derived timeline with the staff member behind each entry, a "Show all" toggle
 * (the first 12 are shown by default) and fully bilingual text. Names come from the staff view's `actorNames`
 * (resolved server-side from the user ids the ledger stores); an unresolved id reads as "a staff member".
 */
import React, { useState } from "react";
import type { StaffBillingView } from "@shared/billing-contract";
import { useT, type TranslationKey } from "@/i18n";
import { formatDay, formatMoneyCompact, localeOf } from "@/lib/owner-presentation";
import { billingHistory, type BillingHistoryEntry, type BillingHistoryKind } from "./billing-summary";

void React;

export const HISTORY_COLLAPSED_COUNT = 12;

const HISTORY_KEY: Record<BillingHistoryKind, TranslationKey> = {
  payment: "owner.bill.h.payment", payment_voided: "owner.bill.h.paymentVoided", adjustment: "owner.bill.h.adjustment", adjustment_voided: "owner.bill.h.adjustmentVoided",
  evidence_submitted: "owner.bill.h.evidence", evidence_confirmed: "owner.bill.h.evidenceOk", evidence_rejected: "owner.bill.h.evidenceNo",
};

export function BillingHistoryList({ view, defaultExpanded = false }: { view: StaffBillingView; defaultExpanded?: boolean }) {
  const { t, language } = useT();
  const locale = localeOf(language);
  const [expanded, setExpanded] = useState(defaultExpanded);
  const history = billingHistory(view);
  const currency = view.student.state === "configured" ? view.student.currency : "USD";
  if (history.length === 0) return <p className="text-sm text-student-muted">{t("owner.bill.hist.empty")}</p>;
  const shown = expanded ? history : history.slice(0, HISTORY_COLLAPSED_COUNT);

  const detail = (h: BillingHistoryEntry): string => {
    switch (h.detailKind) {
      case "payment": {
        const p = h.payment!;
        return `${p.methodLabel}${p.reference ? ` · ${t("owner.bill.ref", { ref: p.reference })}` : ""} · ${t("s32.bill.h.received", { date: formatDay(p.receivedDate, locale) })}`;
      }
      case "evidenceSupporting": return t("s32.bill.h.supporting");
      case "evidenceCounted": return t("s32.bill.h.counted");
      case "evidenceNoReason": return t("s32.bill.h.noReason");
      default: return h.detail;
    }
  };
  const who = (h: BillingHistoryEntry): string | null => {
    if (!h.actorId) return null;
    return t("s32.bill.h.by", { name: view.actorNames?.[h.actorId] ?? t("s32.bill.h.staffMember") });
  };

  return (
    <div data-testid="history-list">
      <ul>
        {shown.map((h) => (
          <li key={h.id} className="grid grid-cols-[5rem_minmax(0,1fr)] gap-3 border-t border-student-line py-2.5 text-sm first:border-t-0 first:pt-0" data-testid="history-item">
            <time className="text-xs text-student-muted" dateTime={h.at}>{formatDay(h.at.slice(0, 10), locale)}</time>
            <p className="min-w-0 break-words text-student-ink">
              {t(HISTORY_KEY[h.kind])}{h.amountCents !== null ? ` · ${formatMoneyCompact(h.amountCents, currency, locale)}` : ""}
              <span className="block text-xs text-student-muted">{detail(h)}</span>
              {who(h) ? <span className="block text-xs text-student-muted" data-testid="history-actor">{who(h)}</span> : null}
            </p>
          </li>
        ))}
      </ul>
      {history.length > HISTORY_COLLAPSED_COUNT ? (
        <button type="button" className="mt-3 inline-flex min-h-9 items-center rounded px-2 text-sm font-medium text-student-gold-ink underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-student-gold-ink"
          onClick={() => setExpanded((v) => !v)} aria-expanded={expanded} data-testid="history-toggle">
          {expanded ? t("s32.bill.h.showFewer") : t("s32.bill.h.showAll", { n: history.length })}
        </button>
      ) : null}
    </div>
  );
}
