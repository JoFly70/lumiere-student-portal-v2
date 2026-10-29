import React, { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ExternalLink, Globe, Lock, Search } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useT, type TranslationKey } from "@/i18n";
import { StaffCard, StaffNotice, StaffPage, StaffPageHeader, staffBtn, staffField } from "@/components/staff/staff-ui";

void React; // classic JSX runtime under vitest/esbuild

interface WebSource { url: string; title: string }
interface WebAnswer {
  mode: "live" | "unavailable";
  reason?: string;
  answer: string | null;
  sources: WebSource[];
  searched: boolean;
  generatedAt: string;
}

const REASON_KEYS = ["not_eligible", "disabled", "not_configured", "budget_exhausted", "provider_error"] as const;
const reasonKey = (r?: string): TranslationKey =>
  (REASON_KEYS as readonly string[]).includes(r ?? "") ? (`owner.web.reason.${r}` as TranslationKey) : "owner.web.reason.provider_error";

/** S27: staff and admin web research. Only the typed question is sent; answers list the sources cited. */
export default function AdminWebResearch() {
  const { t, language } = useT();
  const [question, setQuestion] = useState("");
  const status = useQuery<{ mode: "live" | "unavailable"; reason?: string }>({
    queryKey: ["/api/admin/web-research/status"],
    queryFn: () => api.get("/api/admin/web-research/status"),
  });
  const ask = useMutation<WebAnswer, Error, string>({
    mutationFn: (q) => api.post("/api/admin/web-research", { question: q, language: language === "fr" ? "fr" : "en" }),
  });
  const live = status.data?.mode === "live";
  const result = ask.data;
  const errorText = ask.error instanceof ApiError && ask.error.code === "WEB_RESEARCH_PERSONAL_DATA" ? t("owner.web.personal") : t("owner.web.error");

  return (
    <StaffPage width="wide" testId="admin-web-research">
      <StaffPageHeader eyebrow={t("owner.web.eyebrow")} title={t("owner.web.title")} description={t("owner.web.desc")} />
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <StaffCard className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="web-question" className="text-sm font-medium text-student-ink">{t("owner.web.label")}</label>
            {status.data ? (
              <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs ${live ? "border-student-gold/50 text-student-gold-ink" : "border-student-line text-student-muted"}`} data-testid="web-research-mode">
                <Globe className="h-3.5 w-3.5" aria-hidden="true" />{live ? t("owner.web.live") : t("owner.web.unavailable")}
              </span>
            ) : null}
          </div>
          {status.data && !live ? <StaffNotice tone="info" role="status">{t(reasonKey(status.data.reason))}</StaffNotice> : null}
          <textarea
            id="web-question"
            rows={4}
            maxLength={600}
            className={`${staffField} min-h-[112px] py-2`}
            placeholder={t("owner.web.placeholder")}
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            data-testid="web-research-question"
          />
          <p className="flex items-start gap-2 text-xs text-student-muted"><Lock className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t("owner.web.privacy")}</p>
          <button
            type="button"
            className={`${staffBtn.primary} inline-flex items-center gap-2`}
            disabled={!live || question.trim().length < 3 || ask.isPending}
            onClick={() => ask.mutate(question.trim())}
            data-testid="web-research-ask"
          >
            <Search className="h-4 w-4" aria-hidden="true" />{ask.isPending ? t("owner.web.asking") : t("owner.web.ask")}
          </button>
          {ask.isError ? <StaffNotice tone="attention" role="alert">{errorText}</StaffNotice> : null}
        </StaffCard>

        <StaffCard className="space-y-4" aria-live="polite" data-testid="web-research-result">
          <h2 className="font-serif text-xl text-student-ink">{t("owner.web.answer")}</h2>
          {!result ? <p className="text-sm text-student-muted">{t("owner.web.verify")}</p> : null}
          {result && result.mode === "unavailable" ? <StaffNotice tone="info" role="status">{t(reasonKey(result.reason))}</StaffNotice> : null}
          {result && result.mode === "live" && result.answer ? (
            <>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-student-ink" data-testid="web-research-answer">{result.answer}</div>
              {!result.searched ? <StaffNotice tone="gold" role="status">{t("owner.web.noSearch")}</StaffNotice> : null}
              <div className="space-y-2 border-t border-student-line pt-3">
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-student-muted">{t("owner.web.sources")}</p>
                {result.sources.length === 0 ? <p className="text-sm text-student-muted">{t("owner.web.noSources")}</p> : (
                  <ol className="space-y-1.5" data-testid="web-research-sources">
                    {result.sources.map((s, i) => (
                      <li key={s.url} className="flex min-w-0 items-start gap-2 text-sm">
                        <span className="w-5 shrink-0 text-right text-xs text-student-muted">{i + 1}.</span>
                        <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex min-w-0 items-start gap-1 text-student-gold-ink underline-offset-4 hover:underline">
                          <span className="min-w-0 break-words">{s.title}</span><ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        </a>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
              <p className="text-xs text-student-muted">{t("owner.web.verify")}</p>
            </>
          ) : null}
        </StaffCard>
      </div>
    </StaffPage>
  );
}
