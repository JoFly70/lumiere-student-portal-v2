import React, { useRef, useState } from "react";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { IMPORT_SOURCE_KINDS, IMPORT_TIER_BY_SOURCE, S30_API, type ImportBatchDetail, type ImportSourceKind } from "@shared/s30-contract";
import { ApiError, freshCsrfToken, getAuthToken } from "@/lib/api";
import { useImportMappings, useUploadImport } from "@/lib/s30-import-queries";
import { fileProblem, formatBytes, uploadReasonKey } from "./import-helpers";
import { BTN_PRIMARY, BTN_SECONDARY, FIELD_CLASS, FIELD_STYLE, LABEL_CLASS, LABEL_STYLE, TierPill, useImpT } from "./imports-parts";

export function UploadCard({ onUploaded }: { onUploaded: (batch: ImportBatchDetail) => void }) {
  const { tt } = useImpT();
  const [sourceKind, setSourceKind] = useState<ImportSourceKind>("provider_progress");
  const [providerLabel, setProviderLabel] = useState("");
  const [mappingId, setMappingId] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const upload = useUploadImport();
  const mappings = useImportMappings();
  const savedMappings = (mappings.data ?? []).filter((m) => m.sourceKind === sourceKind);
  const tier = IMPORT_TIER_BY_SOURCE[sourceKind];

  const choose = (f: File | null) => {
    upload.reset();
    setFile(f);
    const p = f ? fileProblem(f) : null;
    setProblem(p ? tt(`imp.reject.${p}`) : null);
  };
  const serverProblem = upload.error instanceof ApiError
    ? (upload.error.code === "S30_FILE_REJECTED" ? tt(uploadReasonKey((upload.error.details as { reason?: string } | undefined)?.reason)) : upload.error.message)
    : upload.error?.message ?? null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!file || problem) return;
    upload.mutate({ file, sourceKind, providerLabel: providerLabel || undefined, mappingId: mappingId || undefined }, {
      onSuccess: (batch) => { setFile(null); if (input.current) input.current.value = ""; onUploaded(batch); },
    });
  };

  const downloadTemplate = async (e: React.MouseEvent) => {
    // Plain link works for cookie sessions; with a bearer token we fetch it so the Authorization header is sent.
    const token = getAuthToken();
    if (!token) return;
    e.preventDefault();
    try {
      const headers = new Headers({ Authorization: `Bearer ${token}` });
      const csrf = await freshCsrfToken(); if (csrf) headers.set("X-CSRF-Token", csrf);
      const res = await fetch(S30_API.importTemplate, { headers, credentials: "include" });
      if (!res.ok) return;
      const url = URL.createObjectURL(await res.blob());
      const a = document.createElement("a"); a.href = url; a.download = "lumiere-academic-import-template.csv"; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch { /* leave the link inert; the user can retry */ }
  };

  return (
    <form className="card" onSubmit={submit} data-testid="imp-upload" aria-labelledby="imp-up-h">
      <div className="ch">
        <h2 id="imp-up-h">{tt("imp.up.title")}</h2>
        <a href={S30_API.importTemplate} download onClick={downloadTemplate} className={BTN_SECONDARY} data-testid="imp-template"><Download className="h-4 w-4" aria-hidden="true" />{tt("imp.up.template")}</a>
      </div>

      <fieldset className="grid gap-2" style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
        <legend className={LABEL_CLASS} style={LABEL_STYLE}>{tt("imp.up.sourceKind")}</legend>
        <div className="grid gap-2 md:grid-cols-3">
          {IMPORT_SOURCE_KINDS.map((k) => {
            const on = k === sourceKind;
            return (
              <label key={k} className="flex cursor-pointer items-start gap-2 rounded-lg border p-3 text-sm focus-within:outline focus-within:outline-2"
                style={{ borderColor: on ? "var(--t-accent)" : "var(--t-line-2)", background: on ? "var(--t-accent-dim)" : "var(--t-panel)", outlineColor: "var(--t-accent)" }}>
                <input type="radio" name="imp-source" value={k} checked={on} onChange={() => { setSourceKind(k); setMappingId(""); }} className="mt-1" data-testid={`imp-source-${k}`} />
                <span className="min-w-0">
                  <strong className="block" style={{ color: "var(--t-heading)" }}>{tt(`imp.source.${k}.label`)}</strong>
                  <span className="small block">{tt(`imp.source.${k}.desc`)}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="small flex flex-wrap items-center gap-2" data-testid="imp-tier-note">
          <span>{tt("imp.tier.produces")}</span><TierPill tier={tier} />
          <span>{tt(`imp.tier.${tier}.note`)}</span>
        </p>
      </fieldset>

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-provider">{tt("imp.up.providerLabel")}</label>
          <input id="imp-provider" className={FIELD_CLASS} style={FIELD_STYLE} maxLength={80} value={providerLabel} placeholder={tt("imp.up.providerPlaceholder")} onChange={(e) => setProviderLabel(e.target.value)} data-testid="imp-provider" />
        </div>
        <div>
          <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-mapping">{tt("imp.up.mapping")}</label>
          <select id="imp-mapping" className={FIELD_CLASS} style={FIELD_STYLE} value={mappingId} onChange={(e) => setMappingId(e.target.value)} data-testid="imp-mapping-select">
            <option value="">{tt("imp.up.mappingNone")}</option>
            {savedMappings.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </div>
      </div>

      <div>
        <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-file">{tt("imp.up.file")}</label>
        <input id="imp-file" ref={input} type="file" accept=".csv,.xlsx" className={FIELD_CLASS} style={FIELD_STYLE} onChange={(e) => choose(e.target.files?.[0] ?? null)}
          aria-describedby="imp-file-hint imp-file-problem" aria-invalid={!!(problem || serverProblem)} data-testid="imp-file-input" />
        <p id="imp-file-hint" className="small mt-1 flex items-center gap-1.5"><FileSpreadsheet className="h-3.5 w-3.5" aria-hidden="true" />{file && !problem ? tt("imp.up.chosen", { name: file.name, size: formatBytes(file.size) }) : tt("imp.up.fileHint")}</p>
        <p id="imp-file-problem" role="alert" className="mt-1 text-sm" style={{ color: "var(--occ-umber)" }} data-testid="imp-file-problem">{problem ?? serverProblem ?? ""}</p>
      </div>

      <ul className="small grid gap-1" style={{ listStyle: "disc", paddingLeft: "1.1rem" }}>
        <li>{tt("imp.up.noPdf")}</li>
        <li>{tt("imp.up.readOnce")}</li>
        <li>{tt("imp.up.studentCode")}</li>
      </ul>

      <div>
        <button type="submit" className={BTN_PRIMARY} disabled={!file || !!problem || upload.isPending} data-testid="imp-submit">
          <Upload className="h-4 w-4" aria-hidden="true" />{upload.isPending ? tt("imp.up.submitting") : tt("imp.up.submit")}
        </button>
      </div>
    </form>
  );
}
