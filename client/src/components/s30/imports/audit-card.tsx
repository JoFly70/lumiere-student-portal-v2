import React, { useState } from "react";
import { Check, Copy } from "lucide-react";
import type { ImportBatchView } from "@shared/s30-contract";
import { formatBytes, shortHash } from "./import-helpers";
import { BTN_SECONDARY, TierPill, useImpT } from "./imports-parts";

export function AuditCard({ batch }: { batch: ImportBatchView }) {
  const { tt, when } = useImpT();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(batch.fileSha256); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard unavailable */ }
  };
  const stamp = (at: string | null, by: string | null) => at ? `${when(at)}${by ? `, ${tt("imp.audit.actor", { id: by })}` : ""}` : tt("imp.audit.notYet");
  const rows: [string, React.ReactNode][] = [
    [tt("imp.audit.file"), <span className="break-all">{batch.fileName ?? tt("imp.hist.unnamed")}</span>],
    [tt("imp.audit.format"), batch.fileFormat.toUpperCase()],
    ...(batch.sheetName ? [[tt("imp.audit.sheet"), batch.sheetName] as [string, React.ReactNode]] : []),
    [tt("imp.audit.size"), formatBytes(batch.fileBytes)],
    [tt("imp.audit.sha"), (
      <span className="inline-flex flex-wrap items-center gap-2">
        <code title={batch.fileSha256} className="text-xs" data-testid="imp-sha">{shortHash(batch.fileSha256)}</code>
        <button type="button" className={BTN_SECONDARY + " !min-h-8 !px-2 !py-1 text-xs"} onClick={copy} data-testid="imp-sha-copy">
          {copied ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Copy className="h-3.5 w-3.5" aria-hidden="true" />}{copied ? tt("imp.audit.copied") : tt("imp.audit.copy")}
        </button>
      </span>
    )],
    [tt("imp.audit.source"), tt(`imp.source.${batch.sourceKind}.label`)],
    ...(batch.providerLabel ? [[tt("imp.audit.provider"), batch.providerLabel] as [string, React.ReactNode]] : []),
    [tt("imp.audit.tier"), <TierPill tier={batch.tier} />],
    [tt("imp.audit.uploaded"), stamp(batch.uploadedAt, batch.uploadedBy)],
    [tt("imp.audit.validated"), batch.validatedAt ? when(batch.validatedAt) : tt("imp.audit.notYet")],
    [tt("imp.audit.approved"), stamp(batch.approvedAt, batch.approvedBy)],
    [tt("imp.audit.committed"), stamp(batch.committedAt, batch.committedBy)],
    ...(batch.rolledBackAt || batch.status === "rolled_back" ? [[tt("imp.audit.rolledBack"), stamp(batch.rolledBackAt, batch.rolledBackBy)] as [string, React.ReactNode]] : []),
    ...(batch.rollbackReason ? [[tt("imp.audit.reason"), batch.rollbackReason] as [string, React.ReactNode]] : []),
  ];
  return (
    <section className="card" aria-labelledby="imp-audit-h" data-testid="imp-audit">
      <div className="ch"><h2 id="imp-audit-h">{tt("imp.audit.title")}</h2></div>
      <dl className="grid gap-x-4 gap-y-2 text-sm sm:grid-cols-[minmax(8rem,12rem)_minmax(0,1fr)]">
        {rows.map(([k, v], i) => (
          <React.Fragment key={i}>
            <dt className="small">{k}</dt>
            <dd className="min-w-0">{v}</dd>
          </React.Fragment>
        ))}
      </dl>
    </section>
  );
}
