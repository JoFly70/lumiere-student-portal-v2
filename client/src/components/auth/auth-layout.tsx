import type { ReactNode } from "react";
import { LANGUAGES, useLanguage, useT } from "@/i18n";
import { LumiereWordmark } from "@/components/brand/lumiere-brand";
import { AuthLines } from "./auth-lines";
import "@/styles/auth.css";

export function AuthLanguageSwitch() {
  const { language, setLanguage } = useLanguage();
  const { t } = useT();
  return (
    <div className="auth-lang" role="radiogroup" aria-label={t("auth.language.label")} data-testid="language-toggle">
      {LANGUAGES.map((l) => (
        <button
          key={l.code}
          type="button"
          role="radio"
          aria-checked={l.code === language}
          aria-label={l.label}
          lang={l.code}
          onClick={() => setLanguage(l.code)}
          data-testid={`button-language-${l.code}`}
        >
          {l.short}
        </button>
      ))}
    </div>
  );
}

/** Shared shell for login, reset-password and verify-email: navy brand panel + theme-following form side. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useT();
  return (
    <div className="auth-root" data-testid="auth-layout">
      <AuthLanguageSwitch />
      <aside className="auth-hero">
        <AuthLines />
        <div className="auth-hero-inner">
          <LumiereWordmark variant="compact" tone="on-dark" className="auth-wm-compact" />
          <LumiereWordmark variant="stacked" tone="on-dark" className="auth-wm-full" />
          <div className="auth-hero-mid">
            <p className="auth-eyebrow">{t("auth.brand.eyebrow")}</p>
            <p className="auth-hero-title">
              {t("auth.hero.title")}
            </p>
            <p className="auth-hero-body">{t("auth.hero.body")}</p>
          </div>
          <div className="auth-hero-foot">
            <span>{t("auth.hero.footer")}</span>
            <span>{t("auth.hero.footerRight")}</span>
          </div>
        </div>
      </aside>
      <main className="auth-side">
        <div className="auth-card">{children}</div>
      </main>
    </div>
  );
}
