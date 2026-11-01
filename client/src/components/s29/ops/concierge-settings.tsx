/** Proactive Concierge settings (admin only). Validated with the shared conciergeSettingsSchema before PUT. */
import React, { useEffect, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { useT } from "@/i18n";
import { DEFAULT_CONCIERGE_SETTINGS, type ConciergeSettings } from "@shared/s29-contract";
import { useConciergeSettings, useSaveConciergeSettings } from "@/lib/s29-ops-queries";
import {
  CONCIERGE_LIMITS, CONCIERGE_NUMBER_FIELDS, draftChanged, parseDraft, toDraft, type ConciergeDraft, type ConciergeNumberField, type OpsKey,
} from "@/lib/s29-ops-presentation";
import { QueryProblem, Section } from "./ops-ui";

export function ConciergeSettingsCard() {
  const { t } = useT();
  const q = useConciergeSettings(true);
  const save = useSaveConciergeSettings();
  const [draft, setDraft] = useState<ConciergeDraft | null>(null);
  const [touched, setTouched] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => { if (q.data && !draft) setDraft(toDraft(q.data)); }, [q.data, draft]);

  const body = (() => {
    if (q.isLoading) return <div className="occ-skel" style={{ height: 180 }} role="status" aria-label={t("s29.ops.loading")} />;
    if (q.isError || !q.data || !draft) return <QueryProblem error={q.error} onRetry={() => void q.refetch()} testId="concierge" />;
    const parsed = parseDraft(draft);
    const dirty = draftChanged(draft, q.data);
    const set = (patch: Partial<ConciergeDraft>) => { setSaved(false); setDraft({ ...draft, ...patch }); };
    const submit = (e: React.FormEvent) => {
      e.preventDefault();
      setTouched(true);
      if (!parsed.ok) return;
      save.mutate(parsed.value, { onSuccess: (s: ConciergeSettings) => { setDraft(toDraft(s)); setTouched(false); setSaved(true); } });
    };
    return (
      <form className="ops-form" onSubmit={submit} noValidate data-testid="concierge-form">
        <div className="ops-fld full ops-switch">
          <button type="button" role="switch" aria-checked={draft.enabled} aria-labelledby="cg-enabled-l" aria-describedby="cg-enabled-h" onClick={() => set({ enabled: !draft.enabled })} data-testid="concierge-enabled" />
          <div>
            <span id="cg-enabled-l" className="ops-lbl-l">{t("s29.ops.cg.enabled")}</span>
            <p id="cg-enabled-h" className="help">{t("s29.ops.cg.enabled.help")}</p>
          </div>
        </div>
        {CONCIERGE_NUMBER_FIELDS.map((f: ConciergeNumberField) => {
          const lim = CONCIERGE_LIMITS[f];
          const err = (touched || draft[f] !== toDraft(q.data!)[f]) && parsed.ok === false && parsed.errors[f];
          const label = t(`s29.ops.cg.${f}` as OpsKey);
          return (
            <div className="ops-fld" key={f}>
              <label htmlFor={`cg-${f}`}>{label}</label>
              <input id={`cg-${f}`} type="text" inputMode="numeric" value={draft[f]} onChange={(e) => set({ [f]: e.target.value } as Partial<ConciergeDraft>)}
                aria-invalid={err ? true : undefined} aria-describedby={`cg-${f}-h`} data-testid={`concierge-${f}`} />
              <p id={`cg-${f}-h`} className="help">{t(`s29.ops.cg.${f}.help` as OpsKey)} <span className="range">{t("s29.ops.cg.range", lim)}</span></p>
              {err ? <p className="err" role="alert"><AlertTriangle aria-hidden="true" />{t("s29.ops.cg.invalid", lim)}</p> : null}
            </div>
          );
        })}
        <div className="ops-fld">
          <span id="cg-lang-l" className="ops-lbl-l">{t("s29.ops.cg.defaultLanguage")}</span>
          <div className="ops-seg" role="group" aria-labelledby="cg-lang-l">
            {(["fr", "en"] as const).map((l) => (
              <button key={l} type="button" aria-pressed={draft.defaultLanguage === l} onClick={() => set({ defaultLanguage: l })} data-testid={`concierge-lang-${l}`}>{t(`s29.ops.cg.lang.${l}` as OpsKey)}</button>
            ))}
          </div>
          <p className="help">{t("s29.ops.cg.defaultLanguage.help")}</p>
        </div>
        <div className="ops-actions full">
          <button type="submit" className="b1 ops-btn" disabled={save.isPending || !dirty} data-testid="concierge-save">
            {save.isPending ? <Loader2 className="ops-spin" aria-hidden="true" /> : null}{save.isPending ? t("s29.ops.cg.saving") : t("s29.ops.cg.save")}
          </button>
          <button type="button" className="b2 ops-btn" disabled={!dirty || save.isPending} onClick={() => { setDraft(toDraft(q.data!)); setTouched(false); }}>{t("s29.ops.cg.reset")}</button>
          <button type="button" className="b2 ops-btn" disabled={save.isPending} onClick={() => set(toDraft(DEFAULT_CONCIERGE_SETTINGS))}>{t("s29.ops.cg.defaults")}</button>
          <span role="status" className={save.isError || (touched && !parsed.ok) ? "ops-fb err" : "ops-fb"}>
            {save.isError ? t("s29.ops.cg.saveFailed") : touched && !parsed.ok ? t("s29.ops.cg.fixErrors") : saved ? t("s29.ops.cg.saved") : ""}
          </span>
        </div>
      </form>
    );
  })();

  return (
    <Section id="concierge" testId="concierge-settings" title={t("s29.ops.cg.title")} sub={t("s29.ops.cg.sub")} >
      {body}
    </Section>
  );
}
