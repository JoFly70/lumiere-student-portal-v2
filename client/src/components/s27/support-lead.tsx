/**
 * S27 Support: the top of the student Support page. Heading, then "Ask Lumière first" (the assistant answers from the
 * student's record; chips open it on a new conversation). The official WhatsApp contact is rendered right below by
 * WhatsAppContactCard. The conversations list and the new-request dialog below it are the existing Support Center.
 */
import React from "react";
import { askAssistant } from "@/components/academic-assistant/logic";
import { useS27T } from "@/lib/s27/i18n-util";
import { LumiereOrb } from "./lumiere-orb";
import "@/styles/student-s27.css";
import "@/styles/student-s27-extra.css";

/** wa.me link for a configured public number, or null (no number, or not a plausible international number). */
export function whatsappHref(raw: string | undefined | null): string | null {
  const digits = (raw ?? "").replace(/[^\d]/g, "");
  return digits.length >= 8 && digits.length <= 15 ? `https://wa.me/${digits}` : null;
}

export function SupportLead({ action }: { action: React.ReactNode }) {
  const { t } = useS27T();
  const chips = [t("s27.sup.q.credits"), t("s27.sup.q.documents"), t("s27.sup.q.urgent")];
  return (
    <div className="s27" data-testid="support-lead">
      <div className="inner">
        <section className="rm2-head">
          <div>
            <span className="eyebrow">{t("s27.sup.eyebrow")}</span>
            <h1 data-testid="text-page-title">{t("s27.sup.title")}</h1>
            <p>{t("s27.sup.intro")}</p>
          </div>
          <div className="btns">
            {action}
          </div>
        </section>
        <section className="sup-ai" aria-labelledby="sup-ai-h" data-testid="support-ask">
          <LumiereOrb size={64} />
          <div>
            <h2 id="sup-ai-h">{t("s27.sup.aiTitle")}</h2>
            <p>{t("s27.sup.aiText")}</p>
            <div className="qs">{chips.map((c) => <button key={c} type="button" className="q" onClick={() => askAssistant(c)}>{c}</button>)}</div>
          </div>
        </section>
      </div>
    </div>
  );
}
