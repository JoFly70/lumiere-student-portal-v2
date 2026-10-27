import { FlaskConical } from "lucide-react";

/** Persistent label for every prototype screen. It is not dismissible on purpose. */
export function PrototypeBanner() {
  return (
    <div className="fdp-banner" role="note" data-testid="prototype-badge">
      <FlaskConical className="h-4 w-4" aria-hidden="true" />
      <strong>Prototype — synthetic data</strong>
      <span>Not a real record. No balance, grade or official standing is shown, and nothing leaves this page.</span>
    </div>
  );
}
