import React, { useEffect, useMemo, useState } from "react";
import { ArrowRight, CopyCheck } from "lucide-react";
import type { ImportBatchDetail, ImportCounts, ImportRowView } from "@shared/s30-contract";
import { ROW_FILTERS, filterRows, measureText, paginate, sortIssues, type RowFilter } from "./import-helpers";
import { BTN_SECONDARY, FIELD_CLASS, FIELD_STYLE, IssueLine, LABEL_CLASS, LABEL_STYLE, useImpT, type Tt } from "./imports-parts";

const COUNT_KEYS: readonly [keyof ImportCounts, string][] = [
  ["total", "imp.count.total"], ["valid", "imp.count.valid"], ["warning", "imp.count.warning"], ["invalid", "imp.count.invalid"],
  ["new", "imp.count.new"], ["changed", "imp.count.changed"], ["unchanged", "imp.count.unchanged"], ["duplicateInFile", "imp.count.duplicateInFile"],
  ["students", "imp.count.students"], ["needsReview", "imp.count.needsReview"],
];

export function CountsGrid({ counts }: { counts: Partial<ImportCounts> }) {
  const { tt } = useImpT();
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" data-testid="imp-counts">
      {COUNT_KEYS.map(([k, label]) => (
        <div key={k} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--t-line-2)", background: "var(--t-panel)" }} data-count={k}>
          <dt className="small">{tt(label)}</dt>
          <dd className="text-xl font-semibold" style={{ color: "var(--t-heading)" }}>{counts[k] ?? 0}</dd>
        </div>
      ))}
    </dl>
  );
}

function Values({ row, tt }: { row: ImportRowView; tt: Tt }) {
  const n = row.normalized;
  const m = measureText(n);
  const parts: [string, string][] = [];
  if (m.status) parts.push([tt("imp.val.status"), tt(`imp.progress.${m.status}`)]);
  if (m.percent) parts.push([tt("imp.val.percent"), m.percent]);
  if (m.score) parts.push([tt("imp.val.score"), m.score]);
  if (m.credits) parts.push([tt("imp.val.credits"), m.credits]);
  if (m.date) parts.push([tt("imp.val.date"), m.date]);
  if (!parts.length) return <span className="small">{tt("imp.val.none")}</span>;
  const p = row.diff === "changed" ? measureText(row.previous) : null;
  const prevOf = (label: string) => {
    if (!p) return null;
    const v = label === tt("imp.val.percent") ? p.percent : label === tt("imp.val.score") ? p.score : label === tt("imp.val.credits") ? p.credits : label === tt("imp.val.date") ? p.date : label === tt("imp.val.status") ? (p.status ? tt(`imp.progress.${p.status}`) : null) : null;
    return v;
  };
  return (
    <ul className="grid gap-0.5 text-xs">
      {parts.map(([label, value]) => {
        const before = prevOf(label);
        return (
          <li key={label}>
            <span style={{ color: "var(--t-muted)" }}>{label}: </span>
            {before && before !== value ? (
              <span data-testid="imp-prev"><span style={{ color: "var(--t-muted)", textDecoration: "line-through" }}><span className="sr-only">{tt("imp.prev.was")} </span>{before}</span> <ArrowRight className="inline h-3 w-3" aria-hidden="true" /> <strong className="whitespace-nowrap">{value}</strong></span>
            ) : <strong className="whitespace-nowrap">{value}</strong>}
          </li>
        );
      })}
    </ul>
  );
}

export function ReviewCard({ batch }: { batch: ImportBatchDetail }) {
  const { tt } = useImpT();
  const [filter, setFilter] = useState<RowFilter>("all");
  const [page, setPage] = useState(1);
  useEffect(() => { setFilter("all"); setPage(1); }, [batch.id]);
  const filtered = useMemo(() => filterRows(batch.rows ?? [], filter), [batch.rows, filter]);
  const pg = paginate(filtered, page);
  const hasPreview = batch.status !== "uploaded" || (batch.rows ?? []).some((r) => r.outcome !== "pending");

  return (
    <section className="card" aria-labelledby="imp-prev-h" data-testid="imp-preview">
      <div className="ch">
        <h2 id="imp-prev-h">{tt("imp.preview.title")}</h2>
      </div>
      <p className="small">{tt("imp.preview.desc")}</p>
      {batch.duplicateOfBatchId && (
        <p className="flex items-start gap-2 rounded-lg border px-3 py-2 text-sm" role="status" data-testid="imp-duplicate"
          style={{ borderColor: "var(--t-line-2)", background: "var(--t-accent-dim)" }}>
          <CopyCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{tt("imp.dup.notice")}
        </p>
      )}
      <CountsGrid counts={batch.counts} />
      {!hasPreview ? <p className="small" data-testid="imp-no-preview">{tt("imp.rows.noPreview")}</p> : (
        <>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <h3 className="text-base">{tt("imp.rows.title")}</h3>
            <div>
              <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-filter">{tt("imp.rows.filter")}</label>
              <select id="imp-filter" className={FIELD_CLASS + " !w-auto min-w-[12rem] max-w-full"} style={FIELD_STYLE} value={filter}
                onChange={(e) => { setFilter(e.target.value as RowFilter); setPage(1); }} data-testid="imp-filter">
                {ROW_FILTERS.map((f) => <option key={f} value={f}>{tt(`imp.filter.${f}`)}</option>)}
              </select>
            </div>
          </div>
          {batch.rowsTruncated && <p className="small" role="status">{tt("imp.rows.truncated")}</p>}
          {filtered.length === 0 ? <p className="small" data-testid="imp-rows-empty">{tt("imp.rows.empty")}</p> : (
            <>
              <div className="relative overflow-x-auto rounded-lg border" style={{ borderColor: "var(--t-line-2)" }} tabIndex={0} role="region" aria-label={tt("imp.rows.title")}>
                <table className="w-full min-w-[56rem] border-collapse text-left text-sm" data-testid="imp-rows">
                  <thead>
                    <tr style={{ background: "var(--t-panel-3)", color: "var(--t-muted)" }}>
                      {(["row", "student", "course", "task", "values", "diff", "issues"] as const).map((c) => (
                        <th key={c} scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wider">{tt(`imp.col.${c}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pg.items.map((r) => (
                      <tr key={r.rowNumber} className="align-top" style={{ borderTop: "1px solid var(--t-line)" }} data-testid="imp-row" data-outcome={r.outcome} data-diff={r.diff ?? ""}>
                        <td className="px-3 py-2 tabular-nums">{r.rowNumber}</td>
                        <td className="px-3 py-2">{r.studentName ? <span>{r.studentName}{r.normalized?.studentCode && <span className="small block">{r.normalized.studentCode}</span>}</span> : <span className="small">{tt("imp.notMatched")}{r.normalized?.studentCode ? ` (${r.normalized.studentCode})` : ""}</span>}</td>
                        <td className="px-3 py-2">{r.normalized?.course ?? ""}</td>
                        <td className="px-3 py-2">{r.normalized?.task ?? ""}</td>
                        <td className="px-3 py-2"><Values row={r} tt={tt} /></td>
                        <td className="px-3 py-2">
                          {r.diff ? <span style={{ whiteSpace: "nowrap" }} className={`pill ${r.diff === "new" ? "ok" : r.diff === "changed" ? "wait" : r.diff === "duplicate_in_file" ? "warn" : "plan"}`}><i aria-hidden="true" />{tt(`imp.diff.${r.diff}`)}</span> : <span className="small">{tt(`imp.outcome.${r.outcome}`)}</span>}
                          {r.diff ? <span className="small mt-1 block">{tt(`imp.outcome.${r.outcome}`)}</span> : null}
                        </td>
                        <td className="px-3 py-2"><ul className="grid gap-1" style={{ listStyle: "none", padding: 0, margin: 0 }}>{sortIssues(r.issues).map((i, k) => <IssueLine key={`${i.code}-${k}`} issue={i} />)}</ul></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="flex flex-wrap items-center justify-between gap-2" aria-label={tt("imp.rows.title")}>
                <span className="small" aria-live="polite">{tt("imp.rows.showing", { from: pg.from, to: pg.to, total: filtered.length })}</span>
                <span className="flex items-center gap-2">
                  <button type="button" className={BTN_SECONDARY} disabled={pg.page <= 1} onClick={() => setPage(pg.page - 1)} data-testid="imp-prev-page">{tt("imp.rows.prev")}</button>
                  <span className="small">{tt("imp.rows.page", { page: pg.page, pages: pg.pages })}</span>
                  <button type="button" className={BTN_SECONDARY} disabled={pg.page >= pg.pages} onClick={() => setPage(pg.page + 1)} data-testid="imp-next-page">{tt("imp.rows.next")}</button>
                </span>
              </nav>
            </>
          )}
        </>
      )}
    </section>
  );
}
