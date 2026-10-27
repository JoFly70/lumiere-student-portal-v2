import { useState, type ReactNode, type InputHTMLAttributes } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from "lucide-react";
import { useT } from "@/i18n";

type FieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "name"> & {
  id: string;
  name: string;
  label: string;
  hint?: string;
  password?: boolean;
  testId?: string;
};

export function AuthField({ id, name, label, hint, password, testId, type, ...rest }: FieldProps) {
  const { t } = useT();
  const [shown, setShown] = useState(false);
  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={id}>{label}</label>
      <div className="auth-control">
        <input
          id={id}
          name={name}
          className="auth-input"
          type={password ? (shown ? "text" : "password") : type}
          data-has-eye={password ? "true" : undefined}
          data-testid={testId}
          aria-describedby={hint ? `${id}-hint` : undefined}
          {...rest}
        />
        {password && (
          <button
            type="button"
            className="auth-eye"
            onClick={() => setShown((s) => !s)}
            aria-label={shown ? t("auth.password.hide") : t("auth.password.show")}
            aria-pressed={shown}
            data-testid={testId ? `${testId}-toggle` : undefined}
          >
            {shown ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
          </button>
        )}
      </div>
      {hint && <p className="auth-hint" id={`${id}-hint`}>{hint}</p>}
    </div>
  );
}

export function AuthAlert({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="auth-alert" role="alert" data-testid={testId}>
      <AlertCircle size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AuthNote({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="auth-note" role="status" data-testid={testId}>
      <CheckCircle2 size={18} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function AuthSubmit({ loading, label, loadingLabel, testId }: { loading: boolean; label: string; loadingLabel: string; testId?: string }) {
  return (
    <button type="submit" className="auth-btn" disabled={loading} aria-busy={loading} data-testid={testId}>
      {loading && <Loader2 size={16} className="auth-spin" aria-hidden="true" />}
      {loading ? loadingLabel : label}
    </button>
  );
}

export function AuthHeading({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="auth-rise">
      <h1 className="auth-title">{title}</h1>
      {subtitle && <p className="auth-sub">{subtitle}</p>}
      <div className="auth-rule" aria-hidden="true" />
    </header>
  );
}

export function AuthStatus({ tone, icon, title, children }: { tone?: "error"; icon: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="auth-status auth-rise">
      <div className="auth-seal" data-tone={tone} aria-hidden="true">{icon}</div>
      <h1 className="auth-title" style={{ fontSize: 32 }}>{title}</h1>
      {children}
    </div>
  );
}
