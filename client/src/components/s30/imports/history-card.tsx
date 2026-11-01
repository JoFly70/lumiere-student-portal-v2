import React from "react";
import { FileText } from "lucide-react";
import type { ImportBatchView } from "@shared/s30-contract";
import { StatusPill, useImpT } from "./imports-parts";

export function HistoryCard({ batches, selectedId, onSelect, loading }: { batches: readonly ImportBatchView[]; selectedId: string | null; onSelect: (id: string) => void; loading?: boolean }) {
  const { tt, when } = useImpT();
  return (
    <section className="card" aria-labelledby="imp-hist-h" data-testid="imp-history">
      <div className="ch"><h2 id="imp-hist-h">{tt("imp.hist.title")}</h2></div>
      {loading ? <p className="small">{tt("imp.loading")}</p> : batches.length === 0 ? <p className="small" data-testid="imp-hist-empty">{tt("imp.hist.empty")}</p> : (
        <ul className="grid gap-2" style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {batches.map((b) => {
            const name = b.fileName ?? tt("imp.hist.unnamed");
            const on = b.id === selectedId;
            return (
              <li key={b.id}>
                <button type="button" onClick={() => onSelect(b.id)} aria-current={on ? "true" : undefined} aria-label={tt("imp.hist.openAria", { name })}
                  className="grid w-full gap-1 rounded-lg border p-3 text-left focus-visible:outline focus-visible:outline-2" data-testid="imp-batch-row" data-batch-id={b.id}
                  style={{ borderColor: on ? "var(--t-accent)" : "var(--t-line-2)", background: on ? "var(--t-accent-dim)" : "var(--t-panel)", color: "var(--t-text)", outlineColor: "var(--t-accent)" }}>
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 font-semibold" style={{ color: "var(--t-heading)" }}><FileText className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 break-all">{name}</span></span>
                    <StatusPill status={b.status} />
                  </span>
                  <span className="small">{tt(`imp.source.${b.sourceKind}.label`)}{b.providerLabel ? ` · ${b.providerLabel}` : ""}</span>
                  <span className="small">{tt("imp.hist.uploaded", { at: when(b.uploadedAt) })}{b.uploadedBy ? ` ${tt("imp.hist.by", { who: b.uploadedBy })}` : ""}</span>
                  <span className="small">
                    {tt("imp.hist.rows", { n: b.counts.total ?? 0 })} · {tt("imp.count.new")} {b.counts.new ?? 0} · {tt("imp.count.changed")} {b.counts.changed ?? 0} · {tt("imp.count.invalid")} {b.counts.invalid ?? 0}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
