/**
 * Official credit as one segmented bar: a slot per requirement area (core first, then electives),
 * filled by the credit officially counted in that area. Ticks mark the area boundaries.
 * Official credit only: reported or planned credit is never drawn here.
 */
import { formatHalfUnits, type HsCreditSummary } from "@shared/high-school-contract";
import { creditSlots, remainingHalfUnits } from "@/lib/admin-high-school-logic";

export function CreditBar({ credits }: { credits: HsCreditSummary }) {
  const slots = creditSlots(credits);
  const total = slots.reduce((n, s) => n + s.requiredHalfUnits, 0) || 1;
  const label = `Officially earned ${formatHalfUnits(credits.earnedHalfUnits)} of ${formatHalfUnits(credits.requiredHalfUnits)} credits. Core ${formatHalfUnits(credits.core.earnedHalfUnits)} of ${formatHalfUnits(credits.core.requiredHalfUnits)}, electives ${formatHalfUnits(credits.elective.earnedHalfUnits)} of ${formatHalfUnits(credits.elective.requiredHalfUnits)}.`;
  return (
    <div data-testid="credit-bar">
      <div role="img" aria-label={label} className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full bg-background">
        {slots.map((s) => (
          <div key={s.key} title={`${s.label}: ${formatHalfUnits(s.countedHalfUnits)} of ${formatHalfUnits(s.requiredHalfUnits)}`} className="h-full min-w-0 bg-muted" style={{ flexGrow: s.requiredHalfUnits, flexBasis: `${(s.requiredHalfUnits * 100) / total}%` }}>
            <div className={`h-full ${s.kind === "core" ? "bg-blue-700 dark:bg-blue-400" : "bg-teal-600 dark:bg-teal-400"}`} style={{ width: `${Math.min(100, (s.countedHalfUnits * 100) / (s.requiredHalfUnits || 1))}%` }} />
          </div>
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-blue-700 dark:bg-blue-400" />Core <span className="tabular-nums text-foreground">{formatHalfUnits(credits.core.earnedHalfUnits)}/{formatHalfUnits(credits.core.requiredHalfUnits)}</span></li>
        <li className="flex items-center gap-1.5"><span aria-hidden="true" className="h-2.5 w-2.5 rounded-sm bg-teal-600 dark:bg-teal-400" />Electives <span className="tabular-nums text-foreground">{formatHalfUnits(credits.elective.earnedHalfUnits)}/{formatHalfUnits(credits.elective.requiredHalfUnits)}</span></li>
        <li><span className="tabular-nums text-foreground">{formatHalfUnits(remainingHalfUnits(credits.requiredHalfUnits, credits.earnedHalfUnits))}</span> remaining</li>
      </ul>
    </div>
  );
}
