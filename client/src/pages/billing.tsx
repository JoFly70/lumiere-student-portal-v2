/**
 * Billing (S18): the student's read-only view of a staff-entered ledger.
 *
 * Data: GET /api/student/billing. Only staff-confirmed receipts count as paid; a receipt the
 * student sent that is still being checked is shown as "awaiting review" and never as money.
 * A student with no ledger sees "Billing is not set up yet", never zeros. There is no payment
 * button, no card or payment-method display, and no gateway.
 *
 * Strings: labels that already exist use t("billing.*") (client/src/i18n). Strings that do not
 * exist there yet live in BILLING_TEXT below so they can be moved into the dictionaries as-is.
 */
import { AlertCircle, CalendarClock, CircleDollarSign, FileText, Hourglass, Landmark, PiggyBank, ReceiptText, RefreshCw, Wallet } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BillingS27 } from "@/components/s27/billing-view";
import { StudentSurface } from "@/components/student-progress/student-ui";
import { useT, type TranslationKey } from "@/i18n";
import { formatBillingDate, paidPercent, useStudentBilling } from "@/lib/billing-queries";
import { cn } from "@/lib/utils";
import { formatMoney, type InstallmentStatus, type StudentBillingConfigured, type StudentInstallment } from "@shared/billing-contract";

/** Strings with no dictionary key yet (English). Move into client/src/i18n as `billing.*` keys. */
export const BILLING_TEXT = {
  loading: "Loading your billing…",
  errorTitle: "We could not load your billing",
  errorDetail: "Your information is safe. Please try again in a moment.",
  retry: "Try again",
  progressTitle: "Payment progress",
  progressLabel: "Share of your program amount paid",
  percentPaid: (pct: number) => `${pct}% paid`,
  netAmount: "Amount after discount",
  discountApplied: (amount: string) => `Includes ${amount} discount`,
  noDiscount: "No discount applied",
  paymentsCount: (n: number) => (n === 1 ? "1 payment recorded" : `${n} payments recorded`),
  noPaymentsYet: "No payments recorded yet",
  creditNote: (amount: string) => `Credit of ${amount} on your account`,
  allPaid: "All payments received",
  noSchedule: "No schedule yet",
  planStatusSettled: "Fully paid",
  planStatusOnTrack: "On schedule",
  planStatusOverdue: "Payment overdue",
  planStatusNoSchedule: "No payment dates set yet",
  breakdownTitle: "Where you stand",
  scheduleTitle: "Payment schedule",
  scheduleNote: "The schedule shows when your remaining amount is expected. It does not add to what you owe.",
  historyTitle: "Payment history",
  historyNote: "Payments confirmed by our team.",
  recentPayments: "Recent payments",
  nextUp: "Coming up",
  date: "Date",
  installment: "Installment",
  paidSoFar: "Paid",
  status: "Status",
  total: "Total",
  awaitingTitle: (n: number) => (n === 1 ? "1 receipt awaiting confirmation" : `${n} receipts awaiting confirmation`),
  awaitingDetail: "We received what you sent. It will count as a payment once our team confirms it.",
  uploadProof: "Upload proof of payment in Documents",
  contactNote: "Questions about your balance? Contact Lumière support.",
  installmentN: (n: number) => `Installment ${n}`,
  installmentsOverdue: (n: number) => (n === 1 ? "1 installment overdue" : `${n} installments overdue`),
  installmentsDue: (n: number) => (n === 1 ? "1 installment due now" : `${n} installments due now`),
} as const;

/** French counterpart of BILLING_TEXT (same shape; checked by the type below). */
export const BILLING_TEXT_FR: { readonly [K in keyof typeof BILLING_TEXT]: (typeof BILLING_TEXT)[K] extends (...a: infer A) => string ? (...a: A) => string : string } = {
  loading: "Chargement de votre facturation…",
  errorTitle: "Nous n’avons pas pu charger votre facturation",
  errorDetail: "Vos informations sont en sécurité. Veuillez réessayer dans un instant.",
  retry: "Réessayer",
  progressTitle: "Progression des paiements",
  progressLabel: "Part du montant de votre programme déjà payée",
  percentPaid: (pct: number) => `${pct} % payé`,
  netAmount: "Montant après remise",
  discountApplied: (amount: string) => `Remise de ${amount} incluse`,
  noDiscount: "Aucune remise appliquée",
  paymentsCount: (n: number) => (n === 1 ? "1 paiement enregistré" : `${n} paiements enregistrés`),
  noPaymentsYet: "Aucun paiement enregistré pour l’instant",
  creditNote: (amount: string) => `Crédit de ${amount} sur votre compte`,
  allPaid: "Tous les paiements ont été reçus",
  noSchedule: "Aucun échéancier pour l’instant",
  planStatusSettled: "Entièrement payé",
  planStatusOnTrack: "Conforme à l’échéancier",
  planStatusOverdue: "Paiement en retard",
  planStatusNoSchedule: "Aucune date de paiement fixée pour l’instant",
  breakdownTitle: "Où vous en êtes",
  scheduleTitle: "Échéancier de paiement",
  scheduleNote: "L’échéancier indique quand le montant restant est attendu. Il ne s’ajoute pas à ce que vous devez.",
  historyTitle: "Historique des paiements",
  historyNote: "Paiements confirmés par notre équipe.",
  recentPayments: "Paiements récents",
  nextUp: "À venir",
  date: "Date",
  installment: "Échéance",
  paidSoFar: "Payé",
  status: "Statut",
  total: "Total",
  awaitingTitle: (n: number) => (n === 1 ? "1 justificatif en attente de confirmation" : `${n} justificatifs en attente de confirmation`),
  awaitingDetail: "Nous avons bien reçu votre envoi. Il comptera comme paiement dès que notre équipe l’aura confirmé.",
  uploadProof: "Déposer un justificatif de paiement dans Documents",
  contactNote: "Une question sur votre solde ? Contactez l’assistance Lumière.",
  installmentN: (n: number) => `Échéance ${n}`,
  installmentsOverdue: (n: number) => (n === 1 ? "1 échéance en retard" : `${n} échéances en retard`),
  installmentsDue: (n: number) => (n === 1 ? "1 échéance à payer maintenant" : `${n} échéances à payer maintenant`),
};

/** Billing strings for the active language. */
export function billingText(language: string): typeof BILLING_TEXT_FR {
  return language === "fr" ? BILLING_TEXT_FR : BILLING_TEXT;
}


const STATUS_KEY: Record<InstallmentStatus, TranslationKey> = {
  paid: "billing.status.paid",
  partially_paid: "billing.status.partiallyPaid",
  due: "billing.status.due",
  overdue: "billing.status.overdue",
  upcoming: "billing.status.upcoming",
};

const STATUS_STYLE: Record<InstallmentStatus, string> = {
  paid: "border-st-applied/30 bg-st-applied/10 text-st-applied",
  partially_paid: "border-st-attention/35 bg-st-attention/10 text-st-attention",
  due: "border-st-progress/35 bg-st-progress/10 text-st-progress",
  overdue: "border-st-attention/35 bg-st-attention/10 text-st-attention",
  upcoming: "border-border bg-muted text-muted-foreground",
};

export function StatusBadge({ status }: { status: InstallmentStatus }) {
  const { t, language } = useT();
  const BT = billingText(language);
  return (
    <span
      className={cn("inline-flex items-center whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}
      data-testid={`badge-status-${status}`}
    >
      {t(STATUS_KEY[status])}
    </span>
  );
}

function SummaryCard({ icon: Icon, label, value, sub, testId, emphasis }: { icon: typeof Wallet; label: string; value: React.ReactNode; sub?: React.ReactNode; testId: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border bg-card p-4 text-card-foreground shadow-sm sm:p-5" data-testid={testId}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</p>
        <Icon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </div>
      <p className={cn("mt-2 break-words text-xl font-bold tabular-nums sm:text-2xl", emphasis && "text-primary")}>{value}</p>
      {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
    </div>
  );
}

function planStatus(v: StudentBillingConfigured, BT: typeof BILLING_TEXT_FR): { label: string; tone: "ok" | "warn" | "neutral" } {
  if (v.remainingCents === 0) return { label: BT.planStatusSettled, tone: "ok" };
  if (v.installments.some((i) => i.status === "overdue")) return { label: BT.planStatusOverdue, tone: "warn" };
  if (v.installments.length === 0) return { label: BT.planStatusNoSchedule, tone: "neutral" };
  return { label: BT.planStatusOnTrack, tone: "ok" };
}

function Summary({ v }: { v: StudentBillingConfigured }) {
  const { t, language } = useT();
  const BT = billingText(language);
  const money = (c: number) => formatMoney(c, v.currency, language);
  const next = v.nextDue;
  const plan = planStatus(v, BT);
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4" data-testid="billing-summary">
      <SummaryCard
        testId="card-agreed"
        icon={Landmark}
        label={t("billing.summary.agreedAmount")}
        value={money(v.agreedCents)}
        sub={v.discountCents > 0 ? `${t("billing.summary.discount")}: −${money(v.discountCents)}` : BT.noDiscount}
      />
      <SummaryCard
        testId="card-paid"
        icon={PiggyBank}
        label={t("billing.summary.paid")}
        value={money(v.paidCents)}
        sub={v.receipts.length === 0 ? BT.noPaymentsYet : BT.paymentsCount(v.receipts.length)}
      />
      <SummaryCard
        testId="card-remaining"
        icon={Wallet}
        label={t("billing.summary.remaining")}
        value={money(v.remainingCents)}
        emphasis={v.remainingCents > 0}
        sub={v.overpaid ? BT.creditNote(money(v.creditCents)) : v.remainingCents === 0 ? BT.allPaid : BT.netAmount + ": " + money(v.netObligationCents)}
      />
      <SummaryCard
        testId="card-next-payment"
        icon={CalendarClock}
        label={next ? t("billing.summary.nextPayment") : t("billing.summary.planStatus")}
        value={next ? money(next.amountCents) : plan.label}
        sub={
          next ? (
            <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t("billing.dueOn", { date: formatBillingDate(next.dueDate, language) })}</span>
              <StatusBadge status={next.status} />
            </span>
          ) : v.remainingCents > 0 && v.installments.length === 0 ? (
            BT.noSchedule
          ) : undefined
        }
      />
    </div>
  );
}

/** The navy progress panel: fixed dark palette so it reads the same under every theme. */
function ProgressPanel({ v }: { v: StudentBillingConfigured }) {
  const { t, language } = useT();
  const BT = billingText(language);
  const money = (c: number) => formatMoney(c, v.currency, language);
  const pct = paidPercent(v.paidCents, v.netObligationCents);
  const overdueN = v.installments.filter((i) => i.status === "overdue").length;
  const dueN = v.installments.filter((i) => i.status === "due").length;
  return (
    <section
      className="overflow-hidden rounded-2xl border border-white/10 p-5 text-[#f2ede3] shadow-md sm:p-6"
      style={{ background: "linear-gradient(135deg, #0b1120 0%, #151f36 100%)" }}
      aria-labelledby="billing-progress-title"
      data-testid="billing-progress"
    >
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="billing-progress-title" className="text-sm font-semibold uppercase tracking-wide text-[#c8ae76]">{BT.progressTitle}</h2>
          <p className="mt-2 text-3xl font-bold tabular-nums sm:text-4xl">
            {money(v.paidCents)} <span className="text-base font-medium text-[#d2ccc0]">/ {money(v.netObligationCents)}</span>
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums text-[#ddca9e]" data-testid="text-percent-paid">{BT.percentPaid(pct)}</p>
      </div>
      <div
        className="mt-4 h-3 w-full overflow-hidden rounded-full bg-white/15"
        role="progressbar"
        aria-label={BT.progressLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #c8ae76, #e6d3a3)" }} />
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-5">
        {[
          [t("billing.summary.agreedAmount"), money(v.agreedCents)],
          [t("billing.summary.discount"), v.discountCents > 0 ? `−${money(v.discountCents)}` : money(0)],
          [BT.netAmount, money(v.netObligationCents)],
          [t("billing.summary.paid"), money(v.paidCents)],
          [t("billing.summary.remaining"), money(v.remainingCents)],
        ].map(([k, val]) => (
          <div key={k}>
            <dt className="text-xs uppercase tracking-wide text-[#c9c3b7]">{k}</dt>
            <dd className="mt-0.5 text-base font-semibold tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>
      {(overdueN > 0 || dueN > 0) && (
        <p className="mt-4 text-sm font-semibold text-[#ddca9e]" role="status" data-testid="billing-installment-alert">
          {[overdueN > 0 ? BT.installmentsOverdue(overdueN) : null, dueN > 0 ? BT.installmentsDue(dueN) : null].filter(Boolean).join(" · ")}
        </p>
      )}
    </section>
  );
}

function Awaiting({ n }: { n: number }) {
  const BT = billingText(useT().language);
  if (n === 0) return null;
  return (
    <div className="flex items-start gap-3 rounded-xl border border-st-attention/35 bg-st-attention/10 p-4 text-sm text-foreground" role="status" data-testid="billing-awaiting">
      <Hourglass className="mt-0.5 h-4 w-4 shrink-0 text-st-attention" aria-hidden />
      <div className="min-w-0">
        <p className="font-semibold">{BT.awaitingTitle(n)}</p>
        <p className="mt-0.5 text-muted-foreground">{BT.awaitingDetail}</p>
        <Link href="/documents" className="mt-2 inline-flex items-center gap-1.5 font-medium text-primary underline-offset-4 hover:underline" data-testid="link-upload-proof">
          <FileText className="h-4 w-4" aria-hidden />
          {BT.uploadProof}
        </Link>
      </div>
    </div>
  );
}

function PanelCard({ title, note, children, testId }: { title: string; note?: string; children: React.ReactNode; testId: string }) {
  return (
    <section className="rounded-xl border bg-card text-card-foreground shadow-sm" data-testid={testId}>
      <header className="border-b px-4 py-3 sm:px-5">
        <h2 className="text-base font-semibold">{title}</h2>
        {note ? <p className="mt-0.5 text-sm text-muted-foreground">{note}</p> : null}
      </header>
      <div>{children}</div>
    </section>
  );
}

function ScheduleTable({ rows, all, currency, limit }: { rows: readonly StudentInstallment[]; all: readonly StudentInstallment[]; currency: string; limit?: number }) {
  const { t, language } = useT();
  const BT = billingText(language);
  const shown = limit ? rows.slice(0, limit) : rows;
  // The compact (overview, half-width) table always uses the stacked three-column layout so long labels never clip.
  const wideCol = limit ? "hidden" : "hidden sm:table-cell";
  const stacked = limit ? "block" : "block sm:hidden";
  if (rows.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">{t("billing.noUpcoming")}</p>;
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={BT.scheduleTitle}>
      <table className="w-full text-sm" data-testid="table-installments">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">{BT.date}</th>
            <th scope="col" className={cn(wideCol, "px-3 py-2.5 font-semibold")}>{BT.installment}</th>
            <th scope="col" className="px-3 py-2.5 text-right font-semibold">{t("billing.amount")}</th>
            <th scope="col" className={cn(wideCol, "px-3 py-2.5 text-right font-semibold")}>{BT.paidSoFar}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold sm:px-5">{BT.status}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((i) => (
            <tr key={i.id} className="border-b last:border-0" data-testid={`row-installment-${i.id}`}>
              <td className="px-4 py-3 font-medium sm:px-5"><span className="whitespace-nowrap">{formatBillingDate(i.dueDate, language)}</span><span className={cn(stacked, "text-xs font-normal text-muted-foreground")}>{i.label ?? BT.installmentN(all.findIndex((x) => x.id === i.id) + 1)}{i.allocatedCents > 0 && i.status !== "paid" ? ` · ${BT.paidSoFar} ${formatMoney(i.allocatedCents, currency, language)}` : ""}</span></td>
              <td className={cn(wideCol, "px-3 py-3 text-muted-foreground")}>{i.label ?? BT.installmentN(all.findIndex((x) => x.id === i.id) + 1)}</td>
              <td className="px-3 py-3 text-right tabular-nums">{formatMoney(i.amountCents, currency, language)}</td>
              <td className={cn(wideCol, "px-3 py-3 text-right tabular-nums text-muted-foreground")}>{formatMoney(i.allocatedCents, currency, language)}</td>
              <td className="px-4 py-3 text-right sm:px-5"><StatusBadge status={i.status} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function HistoryTable({ v, limit }: { v: StudentBillingConfigured; limit?: number }) {
  const { t, language } = useT();
  const BT = billingText(language);
  const rows = limit ? v.receipts.slice(0, limit) : v.receipts;
  if (v.receipts.length === 0) return <p className="px-4 py-8 text-center text-sm text-muted-foreground sm:px-5">{t("billing.noPayments")}</p>;
  return (
    <div className="relative overflow-x-auto" tabIndex={0} role="region" aria-label={BT.historyTitle}>
      <table className="w-full text-sm" data-testid="table-receipts">
        <thead>
          <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
            <th scope="col" className="px-4 py-2.5 font-semibold sm:px-5">{BT.date}</th>
            <th scope="col" className="hidden px-3 py-2.5 font-semibold sm:table-cell">{t("billing.method")}</th>
            <th scope="col" className="px-4 py-2.5 text-right font-semibold sm:px-5">{t("billing.amount")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className="border-b last:border-0" data-testid={`row-receipt-${r.id}`}>
              <td className="px-4 py-3 font-medium sm:px-5"><span className="whitespace-nowrap">{formatBillingDate(r.receivedDate, language)}</span><span className="block text-xs font-normal text-muted-foreground sm:hidden">{r.methodLabel}</span></td>
              <td className="hidden px-3 py-3 text-muted-foreground sm:table-cell">{r.methodLabel}</td>
              <td className="px-4 py-3 text-right font-semibold tabular-nums sm:px-5">{formatMoney(r.amountCents, v.currency, language)}</td>
            </tr>
          ))}
        </tbody>
        {limit === undefined ? (
          <tfoot>
            <tr className="border-t-2">
              <th scope="row" colSpan={1} className="px-4 py-3 text-left font-semibold sm:px-5">{BT.total}</th>
              <td className="px-4 py-3 text-right font-bold tabular-nums sm:px-5" data-testid="text-receipts-total" colSpan={2}>{formatMoney(v.paidCents, v.currency, language)}</td>
            </tr>
          </tfoot>
        ) : null}
      </table>
    </div>
  );
}

function Configured({ v }: { v: StudentBillingConfigured }) {
  const { t, language } = useT();
  const BT = billingText(language);
  const upcoming = v.installments.filter((i) => i.status !== "paid");
  return (
    <div className="space-y-5">
      <Summary v={v} />
      <Awaiting n={v.evidenceAwaitingReview.length} />
      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid h-auto w-full grid-cols-3 sm:inline-flex sm:w-auto" data-testid="billing-tabs">
          <TabsTrigger value="overview" className="whitespace-normal px-2 text-xs sm:px-3 sm:text-sm" data-testid="tab-overview">{t("billing.tab.overview")}</TabsTrigger>
          <TabsTrigger value="history" className="whitespace-normal px-2 text-xs sm:px-3 sm:text-sm" data-testid="tab-history">{t("billing.tab.history")}</TabsTrigger>
          <TabsTrigger value="upcoming" className="whitespace-normal px-2 text-xs sm:px-3 sm:text-sm" data-testid="tab-upcoming">{t("billing.tab.upcoming")}</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-5">
          <ProgressPanel v={v} />
          <div className="grid gap-5 lg:grid-cols-2">
            <PanelCard title={BT.nextUp} testId="panel-next-up">
              <ScheduleTable rows={upcoming} all={v.installments} currency={v.currency} limit={3} />
            </PanelCard>
            <PanelCard title={BT.recentPayments} testId="panel-recent">
              <HistoryTable v={v} limit={3} />
            </PanelCard>
          </div>
        </TabsContent>

        <TabsContent value="history">
          <PanelCard title={BT.historyTitle} note={BT.historyNote} testId="panel-history">
            <HistoryTable v={v} />
          </PanelCard>
        </TabsContent>

        <TabsContent value="upcoming">
          <PanelCard title={BT.scheduleTitle} note={BT.scheduleNote} testId="panel-schedule">
            <ScheduleTable rows={v.installments} all={v.installments} currency={v.currency} />
          </PanelCard>
        </TabsContent>
      </Tabs>
      <p className="text-sm text-muted-foreground">{BT.contactNote}</p>
    </div>
  );
}

function NotConfigured({ awaiting }: { awaiting: number }) {
  const { t, language } = useT();
  const BT = billingText(language);
  return (
    <div className="space-y-4">
      <section className="rounded-xl border bg-card p-6 text-card-foreground shadow-sm sm:p-8" data-testid="billing-not-configured">
        <div className="flex items-start gap-4">
          <div className="rounded-full bg-muted p-3"><CircleDollarSign className="h-6 w-6 text-muted-foreground" aria-hidden /></div>
          <div>
            <h2 className="text-lg font-semibold">{t("billing.notSetUp")}</h2>
            <p className="mt-1 max-w-prose text-sm text-muted-foreground">{t("billing.notSetUpDetail")}</p>
            <p className="mt-3 text-sm text-muted-foreground">{BT.contactNote}</p>
          </div>
        </div>
      </section>
      <Awaiting n={awaiting} />
    </div>
  );
}

function Loading() {
  const BT = billingText(useT().language);
  return (
    <div className="space-y-4" role="status" aria-live="polite" aria-label={BT.loading} data-testid="billing-loading">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}</div>
      <Skeleton className="h-44 rounded-2xl" />
      <Skeleton className="h-56 rounded-xl" />
    </div>
  );
}

function LoadError({ onRetry }: { onRetry: () => void }) {
  const BT = billingText(useT().language);
  return (
    <section className="rounded-xl border border-destructive/40 bg-card p-6 shadow-sm" role="alert" data-testid="billing-error">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" aria-hidden />
        <div>
          <h2 className="font-semibold">{BT.errorTitle}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{BT.errorDetail}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry} data-testid="button-retry">
            <RefreshCw className="mr-2 h-4 w-4" aria-hidden />
            {BT.retry}
          </Button>
        </div>
      </div>
    </section>
  );
}

export default function Billing() {
  const { data, isLoading, error, refetch } = useStudentBilling();
  if (isLoading) return <StudentSurface testId="page-billing"><div className="mx-auto max-w-6xl"><Loading /></div></StudentSurface>;
  if (error || !data) return <StudentSurface testId="page-billing"><div className="mx-auto max-w-6xl"><LoadError onRetry={() => void refetch()} /></div></StudentSurface>;
  return <BillingS27 data={data} />;
}
