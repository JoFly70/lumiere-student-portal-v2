/**
 * S27 Billing (student, read-only): a calm hero (paid in full, or what is left), the payment schedule as month cards
 * with their status, receipts, and receipts still awaiting confirmation. Only staff-confirmed receipts count as paid;
 * there is no payment button. Proof of payment is uploaded in Documents (the existing flow).
 */
import React from "react";
import { Link } from "wouter";
import { formatMoney, type InstallmentStatus, type StudentBillingConfigured, type StudentBillingView } from "@shared/billing-contract";
import { paidPercent } from "@/lib/billing-queries";
import { formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import { S27Page, Eyebrow } from "./ui";

const monthYear = (iso: string, lang: "en" | "fr") => formatDay(iso, lang, "monthYear");

export function BillingS27({ data }: { data: StudentBillingView }) {
  const { t, lang } = useS27T();
  return (
    <S27Page testId="page-billing">
      <section className="rm2-head">
        <div>
          <Eyebrow>{t("s27.bill.eyebrow")}</Eyebrow>
          <h1 data-testid="text-page-title">{t("s27.bill.title")}</h1>
          <p>{t("s27.bill.intro")}</p>
        </div>
      </section>
      {data.state === "not_configured" ? <NotConfigured awaiting={data.evidenceAwaitingReview.length} /> : <Configured v={data} lang={lang} />}
    </S27Page>
  );
}

function Awaiting({ n }: { n: number }) {
  const { t, pl } = useS27T();
  if (n <= 0) return null;
  return (
    <div className="notice" role="status" data-testid="billing-awaiting">
      <b>{pl("s27.bill.awaitingTitle", n)}</b>
      <p>{t("s27.bill.awaitingText")}</p>
      <Link className="link" href="/documents" data-testid="link-upload-proof">{t("s27.bill.uploadProof")} →</Link>
    </div>
  );
}

function NotConfigured({ awaiting }: { awaiting: number }) {
  const { t } = useS27T();
  return (
    <>
      <section className="state" data-testid="billing-not-configured">
        <h2>{t("s27.bill.notSetTitle")}</h2>
        <p>{t("s27.bill.notSetText")}</p>
        <Link className="link" href="/support">{t("s27.bill.question")} {t("s27.bill.contact")} →</Link>
      </section>
      <Awaiting n={awaiting} />
    </>
  );
}

function Configured({ v, lang }: { v: StudentBillingConfigured; lang: "en" | "fr" }) {
  const { t } = useS27T();
  const locale = lang === "fr" ? "fr-CA" : "en-US";
  const money = (c: number) => formatMoney(c, v.currency, locale);
  // "Paid in full" needs real receipts; a zero balance with nothing paid (e.g. a full discount) is "nothing to pay".
  const settled = v.remainingCents === 0;
  const nothingPaid = settled && v.paidCents === 0;
  const pct = paidPercent(v.paidCents, v.netObligationCents);
  const lastReceipt = v.receipts[0];
  return (
    <>
      <section className="paid" data-testid="billing-hero" data-settled={settled ? "true" : "false"}>
        <div>
          <span className="eyebrow bd-eye">{t("s27.bill.title")}</span>
          <h2 style={settled ? undefined : { color: "#f6f1e6" }}>{nothingPaid ? t("s27.bill.nothingTitle") : settled ? t("s27.bill.paidTitle") : t("s27.bill.balanceTitle", { amount: money(v.remainingCents) })}</h2>
          <p>
            {nothingPaid
              ? t("s27.bill.paidTextNoDate")
              : settled
              ? lastReceipt ? t("s27.bill.paidText", { date: formatDay(lastReceipt.receivedDate, lang) }) : t("s27.bill.paidTextNoDate")
              : t("s27.bill.balanceText", { paid: money(v.paidCents), net: money(v.netObligationCents) })}
          </p>
          {v.overpaid && <p>{t("s27.bill.credit", { amount: money(v.creditCents) })}</p>}
        </div>
        <div>
          <span className="k">{t("s27.bill.progress")}</span>
          <div className="meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("s27.bill.progress")} style={{ margin: "10px 0 8px" }}><i style={{ width: `${pct}%` }} /></div>
          <span className="k" style={{ color: "#ecdcb4" }}>{t("s27.bill.percent", { n: pct })} · {money(v.paidCents)} / {money(v.netObligationCents)}</span>
        </div>
      </section>

      <Awaiting n={v.evidenceAwaitingReview.length} />

      <section className="card" aria-labelledby="bill-sched" data-testid="billing-schedule">
        <div><h2 id="bill-sched" className="h2s">{t("s27.bill.schedule")}</h2><p className="small">{t("s27.bill.scheduleNote")}</p></div>
        {v.installments.length === 0 ? (
          <p className="small">{t("s27.bill.noSchedule")}</p>
        ) : (
          <div className="paytl">
            {v.installments.map((i, n) => (
              <div key={i.id} className="pm" data-testid={`installment-${i.id}`} data-status={i.status}>
                <span className="mo">{monthYear(i.dueDate, lang)}</span>
                <b>{money(i.amountCents)}</b>
                <span>{i.label ?? t("s27.bill.installment", { n: n + 1 })} · {formatDay(i.dueDate, lang)}</span>
                {i.status === "partially_paid" && <span>{money(i.allocatedCents)} {t("s27.bill.of", { amount: money(i.amountCents) })}</span>}
                <span className={`chip ${chipClass(i.status)}`}>{t(`s27.bill.status.${i.status}` as TranslationKey)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card" aria-labelledby="bill-rcpt" data-testid="billing-receipts">
        <div><h2 id="bill-rcpt" className="h2s">{t("s27.bill.receipts")}</h2><p className="small">{t("s27.bill.receiptsNote")}</p></div>
        {v.receipts.length === 0 ? (
          <p className="small">{t("s27.bill.noReceipts")}</p>
        ) : (
          <div className="lines">
            {v.receipts.map((r) => <div key={r.id}><span>{r.methodLabel}</span><span>{formatDay(r.receivedDate, lang)} · {money(r.amountCents)}</span></div>)}
          </div>
        )}
      </section>
      <p className="small">{t("s27.bill.question")} <Link className="link" href="/support">{t("s27.bill.contact")} →</Link></p>
    </>
  );
}

function chipClass(status: InstallmentStatus): string {
  if (status === "paid") return "off";
  if (status === "overdue") return "late";
  return "";
}
