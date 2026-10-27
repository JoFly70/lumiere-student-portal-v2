import { formatHalfUnits } from "@shared/high-school-contract";
import { CREDIT_STATUSES, STATUS_LABEL, sumTotals, type CreditStatus, type StatusTotals } from "@/lib/flight-deck-preview-data";

const SIZE = 240;
const C = SIZE / 2;
const R = 100;
const START = 135; // degrees, measured clockwise from east: the arc opens at the bottom
const SWEEP = 270;
const GAP_DEG = 0.9;

function point(angle: number, radius = R): [number, number] {
  const a = (angle * Math.PI) / 180;
  return [C + radius * Math.cos(a), C + radius * Math.sin(a)];
}

function arc(from: number, to: number): string {
  const [x0, y0] = point(from);
  const [x1, y1] = point(to);
  return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${R} ${R} 0 ${to - from > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

const STROKE: Record<Exclude<CreditStatus, "open">, { stroke: string; dash?: string; opacity?: number }> = {
  verified: { stroke: "var(--t-green)" },
  in_progress: { stroke: "var(--t-blue)" },
  planned: { stroke: "var(--t-text-2)", dash: "5 3", opacity: 0.55 },
};

export interface CreditGaugeProps {
  totals: StatusTotals;
  /** "verified": only verified credit is drawn. "projected": verified + in progress + planned. */
  mode: "verified" | "projected";
}

/**
 * Hero credit arc. One 270 degree ring spans the program's configured requirement in half-units;
 * each status is its own segment (colour AND pattern: solid, solid blue, dashed).
 */
export function CreditGauge({ totals, mode }: CreditGaugeProps) {
  const total = sumTotals(totals);
  const shown = mode === "verified" ? totals.verified : totals.verified + totals.in_progress + totals.planned;
  const toAngle = (n: number) => START + (SWEEP * n) / total;

  let cursor = 0;
  const segments = (["verified", "in_progress", "planned"] as const).map((status) => {
    const from = cursor;
    cursor += totals[status];
    return { status, from: toAngle(from), to: toAngle(cursor), n: totals[status] };
  });

  const ticks = Array.from({ length: total / 2 + 1 }, (_, i) => toAngle(i * 2));
  const label =
    `Sample credit gauge of ${formatHalfUnits(total)} configured credits: ` +
    CREDIT_STATUSES.map((s) => `${formatHalfUnits(totals[s])} ${STATUS_LABEL[s].toLowerCase()}`).join(", ");

  return (
    <div className="fdp-gauge" data-testid="credit-gauge">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={label}>
        <path className="track" d={arc(START, START + SWEEP)} />
        {ticks.map((a, i) => {
          const [x0, y0] = point(a, R - 16);
          const [x1, y1] = point(a, R - 21);
          return <line key={i} className="tick" x1={x0} y1={y0} x2={x1} y2={y1} />;
        })}
        {segments.map(({ status, from, to, n }) => {
          if (!n) return null;
          const s = STROKE[status];
          const hidden = mode === "verified" && status !== "verified";
          return (
            <path
              key={status}
              className={`seg${hidden ? " off" : ""}`}
              d={arc(from + GAP_DEG / 2, to - GAP_DEG / 2)}
              stroke={s.stroke}
              strokeDasharray={s.dash}
              opacity={hidden ? 0 : s.opacity}
            >
              <title>{`${STATUS_LABEL[status]}: ${formatHalfUnits(n)} credits`}</title>
            </path>
          );
        })}
      </svg>
      <div className="fdp-gauge-center">
        <div className="fdp-gauge-num tnum" data-testid="gauge-value">{formatHalfUnits(shown)}</div>
        <div className="fdp-gauge-of">of {formatHalfUnits(total)} credits</div>
        <div className="fdp-gauge-cap">{mode === "verified" ? "Verified · sample" : "Incl. planned · sample"}</div>
      </div>
    </div>
  );
}
