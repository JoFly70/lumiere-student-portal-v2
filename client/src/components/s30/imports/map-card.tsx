import React, { useEffect, useMemo, useState } from "react";
import { IMPORT_FIELDS, IMPORT_REQUIRED_FIELDS, type ImportBatchView, type ImportColumnMapping, type ImportField } from "@shared/s30-contract";
import { cleanMapping, initialMapping, missingRequired } from "./import-helpers";
import { BTN_PRIMARY, FIELD_CLASS, FIELD_STYLE, LABEL_CLASS, LABEL_STYLE, useImpT } from "./imports-parts";

export function MapCard({ batch, canValidate, pending, onValidate }: {
  batch: ImportBatchView; canValidate: boolean; pending: boolean; onValidate: (columns: ImportColumnMapping, saveAs?: string) => void;
}) {
  const { tt } = useImpT();
  const start = useMemo(() => initialMapping(batch), [batch]);
  const [mapping, setMapping] = useState<ImportColumnMapping>(start);
  const [saveAs, setSaveAs] = useState("");
  useEffect(() => { setMapping(start); setSaveAs(""); }, [batch.id, start]);
  const missing = missingRequired(mapping);
  const set = (f: ImportField, v: string) => setMapping((m) => ({ ...m, [f]: v || undefined }));

  return (
    <section className="card" data-testid="imp-map" aria-labelledby="imp-map-h">
      <div className="ch">
        <h2 id="imp-map-h">{tt("imp.map.title")}</h2>
        <span className="meta">{tt("imp.map.fileColumns", { n: batch.headers.length })}</span>
      </div>
      <p className="small">{tt("imp.map.desc")}</p>
      <div className="grid items-end gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {IMPORT_FIELDS.map((f) => {
          const required = IMPORT_REQUIRED_FIELDS.includes(f);
          return (
            <div key={f}>
              <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor={`imp-map-${f}`}>
                {tt(`imp.map.field.${f}`)} <span className="normal-case" style={{ color: required ? "var(--occ-umber)" : "var(--t-muted)" }}>({tt(required ? "imp.map.required" : "imp.map.optional")})</span>
              </label>
              <select id={`imp-map-${f}`} className={FIELD_CLASS} style={FIELD_STYLE} value={mapping[f] ?? ""} disabled={!canValidate}
                aria-required={required} onChange={(e) => set(f, e.target.value)} data-testid={`imp-map-${f}`}>
                <option value="">{tt("imp.map.notMapped")}</option>
                {batch.headers.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </div>
          );
        })}
      </div>
      {canValidate && (
        <div className="grid items-end gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
          <div>
            <label className={LABEL_CLASS} style={LABEL_STYLE} htmlFor="imp-save-as">{tt("imp.map.saveAs")}</label>
            <input id="imp-save-as" className={FIELD_CLASS} style={FIELD_STYLE} maxLength={80} value={saveAs} onChange={(e) => setSaveAs(e.target.value)} aria-describedby="imp-save-as-hint" data-testid="imp-save-as" />
            <p id="imp-save-as-hint" className="small mt-1">{tt("imp.map.saveAsHint")}</p>
          </div>
          <button type="button" className={BTN_PRIMARY} disabled={pending || missing.length > 0} onClick={() => onValidate(cleanMapping(mapping), saveAs.trim() || undefined)} data-testid="imp-validate">
            {pending ? tt("imp.map.validating") : tt(batch.status === "validated" ? "imp.map.revalidate" : "imp.map.validate")}
          </button>
        </div>
      )}
      {canValidate && missing.length > 0 && <p className="small" role="status">{tt("imp.map.missing", { fields: missing.map((f) => tt(`imp.map.field.${f}`)).join(", ") })}</p>}
    </section>
  );
}
