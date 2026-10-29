/**
 * S27 Documents: the calm top of the page (header, three tiles, what is needed from the student, what the school issues
 * after the diploma). The upload zone and the full library below it stay as they were. Prop-driven.
 */
import React from "react";
import { FileText, Upload } from "lucide-react";
import type { StudentJourneyView } from "@shared/s27-contract";
import type { HsGraduationView } from "@shared/high-school-contract";
import { docTypeLabel } from "@/lib/document-type-labels";
import { formatDay } from "@/lib/s27/dates";
import { useS27T } from "@/lib/s27/i18n-util";
import type { TranslationKey } from "@/i18n";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";

export interface LeadDoc { readonly id: string; readonly doc_type: string; readonly file_name: string; readonly status: string; readonly review_message?: string | null }

/** Which stored document type answers each agreement deadline. */
export const DEADLINE_DOC_TYPE: Record<string, string> = { language_test: "english_cert", prior_schooling_proof: "hs_transcript" };

export type NeededItem =
  | { readonly kind: "replace"; readonly doc: LeadDoc }
  | { readonly kind: "deadline"; readonly key: string; readonly label: string; readonly rule: string; readonly dueOn: string | null; readonly daysLeft: number | null; readonly docType: string; readonly inReview: boolean };

/** What the student owes: rejected / resubmit-requested files, and open agreement deadlines with no file yet (or one in review). */
export function neededItems(docs: readonly LeadDoc[], journey: StudentJourneyView | null): NeededItem[] {
  const items: NeededItem[] = docs.filter((d) => d.status === "rejected" || d.status === "resubmit_requested").map((doc) => ({ kind: "replace" as const, doc }));
  for (const d of journey?.agreement?.deadlines ?? []) {
    if (d.status !== "open") continue;
    const docType = DEADLINE_DOC_TYPE[d.key];
    if (!docType) continue;
    const mine = docs.filter((x) => x.doc_type === docType);
    if (mine.some((x) => x.status === "verified" || x.status === "rejected" || x.status === "resubmit_requested")) continue;
    items.push({ kind: "deadline", key: d.key, label: d.label, rule: d.rule, dueOn: d.dueOn, daysLeft: d.daysLeft, docType, inReview: mine.some((x) => x.status === "pending") });
  }
  return items;
}

export function DocumentsLead({ docs, journey, graduation, onReplace, onUploadFor, busy }: {
  docs: readonly LeadDoc[];
  journey: StudentJourneyView | null;
  graduation: HsGraduationView | null;
  onReplace: (doc: LeadDoc) => void;
  onUploadFor: (docType: string) => void;
  busy: boolean;
}) {
  const { t, lang, pl } = useS27T();
  const needed = neededItems(docs, journey);
  const approved = docs.filter((d) => d.status === "verified").length;
  const review = docs.filter((d) => d.status === "pending").length;
  const needs = docs.filter((d) => d.status === "rejected" || d.status === "resubmit_requested").length;
  const total = docs.length;
  return (
    <div className="s27" data-testid="documents-lead">
      <div className="inner">
        <section className="rm2-head">
          <div>
            <span className="eyebrow">{t("nav.file")}</span>
            <h1 data-testid="text-page-title">{t("documents.pageTitle")}</h1>
            <p>{t("documents.intro")}</p>
          </div>
        </section>

        <section className="rm2-sum" aria-label={t("s27.docs.summary")}>
          <div><span className="k">{t("s27.docs.tile.needs")}</span><span className="v" style={needs > 0 ? { color: "var(--t-amber)" } : undefined}>{needs}</span></div>
          <div><span className="k">{t("s27.docs.tile.review")}</span><span className="v">{review}</span></div>
          <div><span className="k">{t("s27.docs.tile.approved")}</span><span className="v">{approved}<small>{t("s27.docs.tile.of", { n: total })}</small></span><span className="meter" aria-hidden="true"><i style={{ width: `${total ? (approved / total) * 100 : 0}%` }} /></span></div>
        </section>

        <section className="rm2-sec" aria-labelledby="need-h" data-testid="docs-needed">
          <div className="rm2-st"><h2 id="need-h">{t("s27.docs.need")}</h2><span>{pl("s27.docs.needCount", needed.length)}</span></div>
          {needed.length === 0 && <div className="state"><p>{t("s27.docs.needNone")}</p></div>}
          {needed.map((n) => {
            if (n.kind === "replace") {
              return (
                <div key={n.doc.id} className="needc" data-testid={`needed-${n.doc.id}`}>
                  <div>
                    <b>{docTypeLabel(n.doc.doc_type)}</b>
                    <p>{n.doc.review_message ? n.doc.review_message : t("documents.reviewNoReason")}</p>
                  </div>
                  <div className="btns">
                    <button type="button" className="b1" onClick={() => onReplace(n.doc)} disabled={busy}><Upload size={15} aria-hidden="true" style={{ marginRight: 6 }} />{t("s27.docs.uploadReplacement")}</button>
                  </div>
                </div>
              );
            }
            const late = n.daysLeft !== null && n.daysLeft < 0;
            return (
              <div key={n.key} className={`needc${n.inReview ? " wait" : ""}`} data-testid={`needed-${n.key}`}>
                <div>
                  <b>{n.label}</b>
                  <p>{t(`s27.docs.deadline.${n.key}` as TranslationKey)} {n.key === "prior_schooling_proof" ? t("s27.docs.sendFamily") : ""}</p>
                  {n.dueOn && <span className="due">{late ? t("s27.docs.dueLate", { date: formatDay(n.dueOn, lang) }) : t("s27.docs.due", { date: formatDay(n.dueOn, lang, "weekday") })}</span>}
                  {n.inReview && <p>{t("s27.docs.received")}</p>}
                </div>
                <div className="btns">
                  {!n.inReview && <button type="button" className="b1" onClick={() => onUploadFor(n.docType)} disabled={busy}><Upload size={15} aria-hidden="true" style={{ marginRight: 6 }} />{t("s27.docs.upload")}</button>}
                </div>
              </div>
            );
          })}
        </section>

        {graduation && (
          <section className="rm2-sec" aria-labelledby="after-h" data-testid="docs-after">
            <div className="rm2-st"><h2 id="after-h">{t("s27.docs.after")}</h2><span>{t("s27.docs.afterNote")}</span></div>
            <ul className="doclist locked">
              {([["transcript", graduation.transcript.status], ["diploma", graduation.diploma.status]] as const).map(([k, st]) => (
                <li key={k}><span className="fi" aria-hidden="true"><FileText size={14} /></span><span><b>{t(`s27.docs.${k}` as TranslationKey)}</b></span><span className="pill plan">{t(`s27.docs.state.${st}` as TranslationKey)}</span></li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
