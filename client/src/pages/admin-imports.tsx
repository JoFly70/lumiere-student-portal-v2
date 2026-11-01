/** Academic Data Import Center for admin and staff (S30 Phase B): upload, map, validate, review differences, approve, commit, audit. */
import React, { useMemo, useState } from "react";
import { useLocation, useSearch } from "wouter";
import { ApiError } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { isImportUnavailable, useImportBatch, useImportBatches, useMapImport } from "@/lib/s30-import-queries";
import { ActionsCard } from "@/components/s30/imports/actions-card";
import { AuditCard } from "@/components/s30/imports/audit-card";
import { HistoryCard } from "@/components/s30/imports/history-card";
import { MapCard } from "@/components/s30/imports/map-card";
import { ReviewCard } from "@/components/s30/imports/review-card";
import { UploadCard } from "@/components/s30/imports/upload-card";
import { ErrorCard, IntegrityBanner, StatusPill, Stepper, UnavailableCard, useImpT } from "@/components/s30/imports/imports-parts";
import { actionsFor, isStaffRole } from "@/components/s30/imports/import-helpers";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";
import "@/styles/owner-cockpit.css";

const BASE = "/admin/imports";

export default function AdminImports() {
  const { tt } = useImpT();
  const { user } = useAuth();
  const role = user?.role;
  const [, navigate] = useLocation();
  const search = useSearch();
  const batchId = useMemo(() => new URLSearchParams(search).get("batch") || null, [search]);
  const [note, setNote] = useState<string | null>(null);

  const list = useImportBatches();
  const detail = useImportBatch(batchId);
  const map = useMapImport(batchId ?? "");
  const unavailable = (list.isError && isImportUnavailable(list.error)) || (detail.isError && isImportUnavailable(detail.error));
  const select = (id: string | null) => { setNote(null); map.reset(); navigate(id ? `${BASE}?batch=${encodeURIComponent(id)}` : BASE); };
  const batch = detail.data ?? null;
  const a = actionsFor(role, batch?.status ?? null);
  const allowed = isStaffRole(role);

  const mapError = map.error ? (map.error instanceof ApiError && map.error.code === "S30_INVALID_TRANSITION" ? tt("imp.msg.invalidTransition", { message: map.error.message }) : tt("imp.msg.failed", { message: map.error.message })) : null;

  return (
    <div className="s27 occ" data-testid="imp-page">
      <div className="inner">
        <header className="deck-head">
          <div>
            <p className="eyebrow">{tt("imp.eyebrow")}</p>
            <h1 className="text-3xl">{tt("imp.title")}</h1>
            <p className="small mt-1 max-w-2xl">{tt("imp.subtitle")}</p>
          </div>
          {batch && <div className="status"><StatusPill status={batch.status} /></div>}
        </header>

        {unavailable ? <UnavailableCard /> : !allowed ? null : (
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4">
            <Stepper status={batch?.status ?? null} />
            <IntegrityBanner />
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
                <UploadCard onUploaded={(b) => select(b.id)} />
                {batchId && detail.isLoading && <p className="small" role="status">{tt("imp.loading")}</p>}
                {batchId && detail.isError && !unavailable && <ErrorCard message={detail.error instanceof ApiError && detail.error.status === 404 ? tt("imp.batchNotFound") : detail.error?.message} onRetry={() => void detail.refetch()} />}
                {!batchId && <p className="small" data-testid="imp-select-prompt">{tt("imp.selectPrompt")}</p>}
                {batch && (
                  <>
                    {(batch.status === "uploaded" || batch.status === "validated") && (
                      <MapCard batch={batch} canValidate={a.validate} pending={map.isPending}
                        onValidate={(columns, saveAs) => { setNote(null); map.mutate({ columns, ...(saveAs ? { saveAs } : {}) }, { onSuccess: () => setNote(tt("imp.msg.validated")) }); }} />
                    )}
                    <p role="status" aria-live="polite" className="small" data-testid="imp-map-msg">{mapError ?? note ?? ""}</p>
                  </>
                )}
              </div>
              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)] content-start gap-4">
                <HistoryCard batches={list.data ?? []} selectedId={batchId} onSelect={select} loading={list.isLoading} />
                {list.isError && !unavailable && <ErrorCard message={list.error?.message} onRetry={() => void list.refetch()} />}
                {batch && <AuditCard batch={batch} />}
              </div>
            </div>
            {/* Differences get the full width so every column of the row table stays readable. */}
            {batch && (
              <>
                <ReviewCard batch={batch} />
                <ActionsCard batch={batch} role={role} />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
