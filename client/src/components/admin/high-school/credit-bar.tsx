/**
 * Official credit as one segmented bar: a slot per requirement area (core first, then electives),
 * filled by the credit officially counted in that area. Below it a visible legend names every area with
 * earned/required (text, so it works on touch and for screen readers; nothing depends on hover).
 * Official credit only: reported or planned credit is never drawn here.
 */
import { formatHalfUnits, type HsCreditSummary } from "@shared/high-school-contract";
import { creditSlots, remainingHalfUnits } from "@/lib/admin-high-school-logic";

const FILL = { core: "bg-student-gold", elective: "bg-student-gold-ink" } as const;

export function CreditBar({ credits }: { credits: HsCreditSummary }) {
  const slots = creditSlots(credits);
  const total = slots.reduce((n, s) => n + s.requiredHalfUnits, 0) || 1;
  const label = `Officially earned ${formatHalfUnits(credits.earnedHalfUnits)} of ${formatHalfUnits(credits.requiredHalfUnits)} credits. Core ${formatHalfUnits(credits.core.earnedHalfUnits)} of ${formatHalfUnits(credits.core.requiredHalfUnits)}, electives ${formatHalfUnits(credits.elective.earnedHalfUnits)} of ${formatHalfUnits(credits.elective.requiredHalfUnits)}.`;
  return (
    <div data-testid="credit-bar">
      <div role="img" aria-label={label} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-background">
        {slots.map((s) => (
          <div key={s.key} className="h-full min-w-0 bg-muted" style={{ flexGrow: s.requiredHalfUnits, flexBasis: `${(s.requiredHalfUnits * 100) / total}%` }}>
            <div className={`h-full ${FILL[s.kind]}`} style={{ width: `${Math.min(100, (s.countedHalfUnits * 100) / (s.requiredHalfUnits || 1))}%` }} />
          </div>
        ))}
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-3 lg:grid-cols-4" data-testid="credit-legend" aria-label="Official credit by area">
        {slots.map((s) => (
          <li key={s.key} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2.5 w-2.5 shrink-0 rounded-sm ${FILL[s.kind]}`} />
            <span className="min-w-0 flex-1 leading-tight text-muted-foreground">{s.label}</span>
            <span className="tabular-nums text-foreground">{formatHalfUnits(s.earnedHalfUnits)}/{formatHalfUnits(s.requiredHalfUnits)}</span>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-xs text-muted-foreground"><span className="tabular-nums text-foreground">{formatHalfUnits(remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits))}</span> credits remaining · official credit only</p>
    </div>
  );
}
