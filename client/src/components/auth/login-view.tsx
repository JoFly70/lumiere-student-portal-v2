import { useId, useState } from "react";
import { useT } from "@/i18n";
import { AuthLayout } from "./auth-layout";
import { AuthAlert, AuthField, AuthHeading, AuthNote, AuthSubmit } from "./auth-parts";

export type LoginMode = "signin" | "invite";

/** Invitation code from a query string (`?invite=<code>`). Empty string when absent. */
export function parseInviteCode(search: string): string {
  try {
    return new URLSearchParams(search).get("invite") ?? "";
  } catch {
    return "";
  }
}

export interface LoginViewProps {
  login: (email: string, password: string) => Promise<void>;
  signup: (email: string, password: string, fullName: string, invitationToken: string) => Promise<void>;
  onNavigate: (path: string) => void;
  /** Initial invitation code (from the URL); a non-empty value opens the invitation tab. */
  initialInvite?: string;
  initialMode?: LoginMode;
}

export function LoginView({ login, signup, onNavigate, initialInvite = "", initialMode }: LoginViewProps) {
  const { t } = useT();
  const tabsId = useId();
  const [mode, setMode] = useState<LoginMode>(initialMode ?? (initialInvite ? "invite" : "signin"));

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupInvitation, setSignupInvitation] = useState(initialInvite);
  const [signupError, setSignupError] = useState("");
  const [signupNotice, setSignupNotice] = useState("");
  const [signupLoading, setSignupLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError("");
    setLoginLoading(true);
    try {
      await login(loginEmail, loginPassword);
    } catch (error) {
      setLoginError(error instanceof Error && error.message ? error.message : t("auth.signin.failed"));
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    setSignupError("");
    setSignupNotice("");
    setSignupLoading(true);
    try {
      await signup(signupEmail, signupPassword, signupName, signupInvitation.trim());
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("check your email")) {
        // Email verification is required: confirm inline and send the person to sign in.
        setSignupNotice(t("auth.invite.created"));
        setLoginEmail(signupEmail);
        setMode("signin");
      } else {
        setSignupError(message || t("auth.invite.failed"));
      }
    } finally {
      setSignupLoading(false);
    }
  };

  const tabs: Array<{ id: LoginMode; label: string }> = [
    { id: "signin", label: t("auth.tab.signin") },
    { id: "invite", label: t("auth.tab.invite") },
  ];
  const onTabKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      setMode((m) => (m === "signin" ? "invite" : "signin"));
    }
  };

  return (
    <AuthLayout>
      <div className="auth-main">
        <AuthHeading
          title={mode === "signin" ? t("auth.signin.title") : t("auth.invite.title")}
          subtitle={mode === "signin" ? t("auth.signin.subtitle") : t("auth.invite.subtitle")}
        />

        <div className="auth-tabs auth-rise" style={{ ["--d" as string]: "80ms" }} role="tablist" aria-label={t("auth.tablist")} onKeyDown={onTabKey}>
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              id={`${tabsId}-tab-${tab.id}`}
              aria-selected={mode === tab.id}
              aria-controls={`${tabsId}-panel-${tab.id}`}
              tabIndex={mode === tab.id ? 0 : -1}
              className="auth-tab"
              data-testid={`tab-${tab.id === "signin" ? "login" : "signup"}`}
              onClick={() => setMode(tab.id)}
            >
              {tab.label}
            </button>
          ))}
          <span className="auth-tab-bar" data-pos={mode === "signin" ? "0" : "1"} aria-hidden="true" />
        </div>

        {signupNotice && mode === "signin" && <AuthNote testId="text-signup-notice">{signupNotice}</AuthNote>}

        {mode === "signin" ? (
          <form
            onSubmit={handleLogin}
            className="auth-form auth-rise"
            style={{ ["--d" as string]: "140ms" }}
            role="tabpanel"
            id={`${tabsId}-panel-signin`}
            aria-labelledby={`${tabsId}-tab-signin`}
            data-testid="form-login"
          >
            <AuthField
              id="login-email" name="email" type="email" label={t("auth.field.email")} placeholder={t("auth.field.emailPlaceholder")}
              value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required autoComplete="email" testId="input-login-email-field"
            />
            <AuthField
              id="login-password" name="password" password label={t("auth.field.password")}
              value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required autoComplete="current-password" testId="input-login-password"
            />
            {loginError && <AuthError message={loginError} />}
            <AuthSubmit loading={loginLoading} label={t("auth.signin.submit")} loadingLabel={t("auth.signin.loading")} testId="button-login" />
          </form>
        ) : (
          <form
            onSubmit={handleSignup}
            className="auth-form auth-rise"
            role="tabpanel"
            id={`${tabsId}-panel-invite`}
            aria-labelledby={`${tabsId}-tab-invite`}
            data-testid="form-signup"
          >
            <AuthField
              id="signup-invitation" name="invitation" type="text" label={t("auth.field.invitation")} hint={t("auth.field.invitationHint")}
              value={signupInvitation} onChange={(e) => setSignupInvitation(e.target.value)} required autoComplete="off" spellCheck={false} testId="input-signup-invitation"
            />
            <AuthField
              id="signup-name" name="name" type="text" label={t("auth.field.fullName")} placeholder={t("auth.field.fullNamePlaceholder")}
              value={signupName} onChange={(e) => setSignupName(e.target.value)} required autoComplete="name" testId="input-signup-name"
            />
            <AuthField
              id="signup-email" name="email" type="email" label={t("auth.field.email")} placeholder={t("auth.field.emailPlaceholder")}
              value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required autoComplete="email" testId="input-signup-email"
            />
            <AuthField
              id="signup-password" name="new-password" password label={t("auth.field.newPassword")} hint={t("auth.field.passwordHint")}
              value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required minLength={6} autoComplete="new-password" testId="input-signup-password"
            />
            {signupError && <AuthError message={signupError} />}
            <AuthSubmit loading={signupLoading} label={t("auth.invite.submit")} loadingLabel={t("auth.invite.loading")} testId="button-signup" />
          </form>
        )}

        <div className="auth-foot auth-rise" style={{ ["--d" as string]: "220ms" }}>
          <a
            href="/reset-password"
            className="auth-link"
            data-testid="link-forgot-password"
            onClick={(e) => {
              e.preventDefault();
              onNavigate("/reset-password");
            }}
          >
            {t("auth.forgot")}
          </a>
          <span>{t("auth.help")}</span>
        </div>
      </div>
    </AuthLayout>
  );
}

function AuthError({ message }: { message: string }) {
  return <AuthAlert testId="text-auth-error">{message}</AuthAlert>;
}
