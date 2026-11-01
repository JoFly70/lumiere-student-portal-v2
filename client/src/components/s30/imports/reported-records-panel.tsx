/** Imported (reported, never verified) records for one student. Placed in the admin student file. */
import React from "react";
import { useAuth } from "@/lib/auth";
import { useReportedRecords, useReviewReportedRecord, isImportUnavailable } from "@/lib/s30-import-queries";
import { measureText } from "./import-helpers";
import { BTN_SECONDARY, ErrorCard, IntegrityBanner, TierPill, UnavailableCard, useImpT } from "./imports-parts";

export function ReportedRecordsPanel({ studentId }: { studentId: string }) {
  const { tt, day } = useImpT();
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const q = useReportedRecords(studentId);
  const review = useReviewReportedRecord(studentId);

  return (
    <section className="card" aria-labelledby="imp-rr-h" data-testid="reported-records">
      <div className="ch"><h2 id="imp-rr-h" className="text-lg">{tt("imp.rr.title")}</h2></div>
      <IntegrityBanner compact />
      {q.isLoading ? <p className="small">{tt("imp.loading")}</p>
        : q.isError ? (isImportUnavailable(q.error) ? <UnavailableCard testId="imp-rr-unavailable" /> : <ErrorCard message={q.error instanceof Error ? q.error.message : undefined} onRetry={() => void q.refetch()} />)
        : (q.data ?? []).length === 0 ? <p className="small" data-testid="imp-rr-empty">{tt("imp.rr.empty")}</p>
        : (
          <div className="relative overflow-x-auto rounded-lg border" style={{ borderColor: "var(--t-line-2)" }} tabIndex={0} role="region" aria-label={tt("imp.rr.title")}>
            <table className="w-full min-w-[52rem] border-collapse text-left text-sm">
              <thead>
                <tr style={{ background: "var(--t-panel-3)", color: "var(--t-muted)" }}>
                  {(["course", "task", "tier", "status", "percent", "score", "credits", "reportedOn", "review"] as const).map((c) => <th key={c} scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">{tt(`imp.rr.col.${c}`)}</th>)}
                </tr>
              </thead>
              <tbody>
                {(q.data ?? []).map((r) => {
                  const m = measureText(r);
                  const canToggle = isAdmin && r.reviewState !== "none";
                  return (
                    <tr key={r.id} className="align-top" style={{ borderTop: "1px solid var(--t-line)" }} data-testid="imp-rr-row" data-review={r.reviewState}>
                      <td className="px-3 py-2">{r.courseLabel}</td>
                      <td className="px-3 py-2">{r.taskLabel ?? ""}</td>
                      <td className="px-3 py-2"><TierPill tier={r.tier} />{r.providerLabel && <span className="small block">{r.providerLabel}</span>}</td>
                      <td className="px-3 py-2">{m.status ? tt(`imp.progress.${m.status}`) : ""}</td>
                      <td className="px-3 py-2 tabular-nums">{m.percent ?? ""}</td>
                      <td className="px-3 py-2 tabular-nums">{m.score ?? ""}</td>
                      <td className="px-3 py-2 tabular-nums">{m.credits ? <>{m.credits}<span className="small block">{tt("imp.rr.creditsInfo")}</span></> : ""}</td>
                      <td className="px-3 py-2">{day(r.reportedOn)}</td>
                      <td className="px-3 py-2">
                        <span style={{ whiteSpace: "nowrap" }} className={`pill ${r.reviewState === "needs_review" ? "warn" : r.reviewState === "reviewed" ? "ok" : "plan"}`}><i aria-hidden="true" />{tt(`imp.review.${r.reviewState}`)}</span>
                        {canToggle && (
                          <button type="button" className={BTN_SECONDARY + " mt-1 !min-h-8 !px-2 !py-1 text-xs"} disabled={review.isPending} data-testid="imp-rr-toggle"
                            onClick={() => review.mutate({ id: r.id, reviewState: r.reviewState === "needs_review" ? "reviewed" : "needs_review" })}>
                            {tt(r.reviewState === "needs_review" ? "imp.rr.markReviewed" : "imp.rr.backToReview")}
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      {review.isError && <p role="alert" className="small">{review.error.message}</p>}
    </section>
  );
}
