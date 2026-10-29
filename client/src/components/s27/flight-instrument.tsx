/**
 * The flight-path instrument: a quadratic SVG arc from "Enrolled" to the diploma seal, a gold flown trail, stops at
 * the plan's phase credit milestones, a plane at the school-confirmed credits, one bead per projected week and an
 * optional ghost plane that flies a what-if pace. The plane animates once on load; prefers-reduced-motion skips all
 * motion and shows the final state.
 */
import React, { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import crestUrl from "@/assets/brand/crest-96.webp";
import { addDaysIso } from "@/lib/s27/dates";
import { angleOnArc, arcGeometry, arcPath, beadFractions, pointOnArc } from "@/lib/s27/cockpit-model";

const PLANE = "M-7,1.2 L-1.5,1.2 L-4.8,7 L-2.6,7 L3,1.2 L6.2,1.2 Q8,1.2 8,0 Q8,-1.2 6.2,-1.2 L3,-1.2 L-2.6,-7 L-4.8,-7 L-1.5,-1.2 L-7,-1.2 L-8.4,-3.6 L-9.8,-3.6 L-8.8,0 L-9.8,3.6 L-8.4,3.6 Z";

export interface InstrumentStop {
  readonly id: string;
  readonly credits: number;
  readonly reached: boolean;
  readonly name: string;
  /** "3 credits · reached" / "8 credits · est. 29 Nov". */
  readonly sub: string;
  readonly tipBody: string;
}

export interface GhostRun { readonly runId: number; readonly pace: number }

export interface InstrumentProps {
  readonly required: number;
  readonly confirmed: number;
  readonly stops: readonly InstrumentStop[];
  /** Pace used for the projected-week beads (scenario pace when one is chosen). */
  readonly beadPace: number | null;
  readonly today: string;
  readonly ariaLabel: string;
  readonly enrolledLabel: string;
  readonly enrolledDate: string;
  readonly diplomaTitle: string;
  readonly diplomaSub: string;
  readonly youLabel: string;
  readonly formatDay: (iso: string) => string;
  readonly beadLabel: (date: string) => string;
  readonly ghost: GhostRun | null;
  readonly ghostLabel: (date: string, credits: string) => string;
  readonly landLabel: (date: string) => string;
  /** Remaining credits / pace -> weeks, for the ghost flight duration. */
  readonly arrivalOf: (pace: number) => string | null;
}

const prefersReducedMotion = (): boolean => {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function useWidth(ref: React.RefObject<HTMLElement>): number {
  const [w, setW] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const read = () => setW(Math.round(el.clientWidth));
    read();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", read);
      return () => window.removeEventListener("resize", read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return w;
}

export function FlightInstrument(p: InstrumentProps) {
  const mapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mapRef);
  const uid = useId().replace(/:/g, "");
  const height = width > 0 && width < 700 ? 280 : 340;
  const g = width > 0 ? arcGeometry(width, height) : null;
  const now = p.required > 0 ? Math.max(0, Math.min(1, p.confirmed / p.required)) : 0;

  // Plane: flies in once on load (unless reduced motion), then rests at the confirmed credits.
  const [planeT, setPlaneT] = useState<number>(prefersReducedMotion() ? now : 0.001);
  const played = useRef(false);
  useEffect(() => {
    if (!g) return undefined;
    if (prefersReducedMotion() || played.current) { setPlaneT(now); return undefined; }
    played.current = true;
    let raf = 0;
    const t0 = performance.now();
    const step = (ts: number) => {
      const k = Math.min(1, (ts - t0) / 1400);
      const e = 1 - Math.pow(1 - k, 3);
      setPlaneT(Math.max(0.001, now * e));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [g !== null, now]);

  // Ghost plane: a what-if flight from today's credits to the diploma at the scenario pace.
  const [ghost, setGhost] = useState<{ t: number; label: string; fading: boolean } | null>(null);
  useEffect(() => {
    if (!p.ghost || !g) { setGhost(null); return undefined; }
    const { pace } = p.ghost;
    const remaining = Math.max(0, p.required - p.confirmed);
    const weeks = pace > 0 ? remaining / pace : 0;
    const arrival = p.arrivalOf(pace);
    const reduce = prefersReducedMotion();
    const dur = reduce ? 0 : Math.max(1100, Math.min(3200, weeks * 330));
    const t0 = performance.now();
    let raf = 0;
    let fade = 0;
    const frame = (ts: number) => {
      const k = dur ? Math.min(1, (ts - t0) / dur) : 1;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const c = p.confirmed + remaining * e;
      const label = k < 1
        ? p.ghostLabel(p.formatDay(addDaysIso(p.today, Math.round(e * weeks * 7))), c.toFixed(1))
        : p.landLabel(arrival ? p.formatDay(arrival) : "");
      setGhost({ t: Math.min(0.999, c / p.required), label, fading: false });
      if (k < 1) raf = requestAnimationFrame(frame);
      else fade = window.setTimeout(() => setGhost((s) => (s ? { ...s, fading: true } : s)), reduce ? 2500 : 300);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(fade); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.ghost?.runId, g !== null]);

  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);
  const showTip = useCallback((x: number, y: number, title: string, body: string) => setTip({ x, y, title, body }), []);

  const beads = g ? beadFractions(p.confirmed, p.required, p.beadPace) : [];
  const narrow = g?.narrow ?? false;

  return (
    <div className="map" ref={mapRef} role="group" aria-label={p.ariaLabel} data-testid="flight-instrument" style={{ height }}>
      {g && (
        <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="false">
          <defs>
            <linearGradient id={`${uid}trail`} x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="var(--t-accent)" stopOpacity=".25" /><stop offset="1" stopColor="var(--t-accent)" /></linearGradient>
            <linearGradient id={`${uid}gold`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F6E3B4" /><stop offset=".45" stopColor="#D2AE66" /><stop offset="1" stopColor="#8E6A2B" /></linearGradient>
            <radialGradient id={`${uid}halo`}><stop offset="0" stopColor="#E9C77F" stopOpacity=".45" /><stop offset="1" stopColor="#E9C77F" stopOpacity="0" /></radialGradient>
          </defs>
          <line x1={g.A.x - 14} x2={g.B.x} y1={g.base} y2={g.base} stroke="var(--t-line-2)" />
          <path d={arcPath(g, now, 1)} fill="none" stroke="var(--t-line-3)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
          {beads.map((t, i) => {
            const bp = pointOnArc(g, t);
            return (
              <circle key={i} cx={bp.x} cy={bp.y} r="3" fill="var(--t-panel)" stroke="var(--t-accent)" strokeWidth="1.4">
                <title>{p.beadLabel(p.formatDay(addDaysIso(p.today, (i + 1) * 7)))}</title>
              </circle>
            );
          })}
          {now > 0 && <path d={arcPath(g, 0, now)} fill="none" stroke="var(--t-accent-dim)" strokeWidth="14" strokeLinecap="round" />}
          {now > 0 && <path d={arcPath(g, 0, now)} fill="none" stroke={`url(#${uid}trail)`} strokeWidth="3" strokeLinecap="round" />}
          <circle cx={g.A.x} cy={g.A.y} r="6" fill="var(--t-accent)" />
          <text x={g.A.x} y={g.A.y + 26} textAnchor={narrow ? "start" : "middle"} fill="var(--t-heading)" style={{ font: "600 12px var(--font-sans)" }}>{p.enrolledLabel}</text>
          {p.enrolledDate && <text x={g.A.x} y={g.A.y + 41} textAnchor={narrow ? "start" : "middle"} fill="var(--t-muted)" style={{ font: "400 11px var(--font-sans)" }}>{p.enrolledDate}</text>}

          {p.stops.map((s) => {
            const f = p.required > 0 ? s.credits / p.required : 0;
            const pt = pointOnArc(g, f);
            const near = Math.abs(f - now) < 0.1;
            const nx = near ? pt.x - (narrow ? 14 : 20) : pt.x;
            const anchor = near ? "end" : "middle";
            const show = () => showTip(pt.x, pt.y - (narrow ? 30 : 56), `${s.name} · ${s.sub}`, s.tipBody);
            return (
              <g key={s.id} className="stop" tabIndex={0} role="button" aria-label={`${s.name}. ${s.sub}`}
                onMouseEnter={show} onMouseLeave={() => setTip(null)} onFocus={show} onBlur={() => setTip(null)} onClick={show}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); show(); } if (e.key === "Escape") setTip(null); }}>
                <circle cx={pt.x} cy={pt.y} r="18" fill="transparent" />
                <circle className="stopdot" cx={pt.x} cy={pt.y} r="7" fill={s.reached ? "var(--t-accent)" : "var(--t-panel)"} stroke={s.reached ? "var(--t-panel)" : "var(--t-line-3)"} strokeWidth={s.reached ? 3 : 2} />
                {s.reached && <path d={`M${pt.x - 3},${pt.y} l2,2.2 l4,-4.2`} fill="none" stroke="var(--t-accent-ink)" strokeWidth="1.6" strokeLinecap="round" />}
                <text x={nx} y={pt.y - (narrow ? 14 : 20)} textAnchor={anchor} fill="var(--t-heading)" style={{ font: `500 ${narrow ? 16 : 20}px var(--font-display)` }}>{s.name}</text>
                {!narrow && <text x={nx} y={pt.y - 40} textAnchor={anchor} fill={s.reached ? "var(--t-accent-text)" : "var(--t-muted)"} style={{ font: "500 10px var(--font-sans)", letterSpacing: ".08em", textTransform: "uppercase" }}>{s.sub}</text>}
              </g>
            );
          })}

          {/* diploma seal: gold rosette, ribbons and the crest */}
          <g transform={`translate(${g.B.x},${g.B.y}) scale(${narrow ? 0.62 : 0.9})`}>
            <circle r="62" fill={`url(#${uid}halo)`} />
            <path d="M-14,22 L-26,62 L-16,56 L-9,66 L-2,28Z" fill="#9E2B2B" />
            <path d="M14,22 L26,62 L16,56 L9,66 L2,28Z" fill="#7E1F22" />
            <path d={rosette()} fill={`url(#${uid}gold)`} />
            <circle r="28" fill="none" stroke="#7A5A22" strokeWidth=".8" opacity=".7" />
            {Array.from({ length: 60 }, (_, j) => {
              const a = (j / 60) * Math.PI * 2;
              return <line key={j} x1={Math.cos(a) * 25.5} y1={Math.sin(a) * 25.5} x2={Math.cos(a) * 27.5} y2={Math.sin(a) * 27.5} stroke="#7A5A22" strokeWidth=".7" opacity=".55" />;
            })}
            <circle r="24" fill="var(--t-panel)" stroke="#B48A45" strokeWidth="1" />
            <image href={crestUrl} x="-14" y="-15" width="28" height="29" />
          </g>
          <text x={narrow ? width - 12 : g.B.x} y={g.B.y + (narrow ? 60 : 78)} textAnchor={narrow ? "end" : "middle"} fill="var(--t-heading)" style={{ font: `500 ${narrow ? 16 : 20}px var(--font-display)` }}>{p.diplomaTitle}</text>
          <text x={narrow ? width - 12 : g.B.x} y={g.B.y + (narrow ? 76 : 96)} textAnchor={narrow ? "end" : "middle"} fill="var(--t-accent-text)" style={{ font: "600 10px var(--font-sans)", letterSpacing: ".12em", textTransform: "uppercase" }}>{p.diplomaSub}</text>

          {/* ghost scenario plane */}
          {ghost && <GhostPlane g={g} ghost={ghost} width={width} />}

          {/* you */}
          <Traveller g={g} t={planeT} label={p.youLabel} narrow={narrow} />
        </svg>
      )}
      <div className="tip" role="status" style={tip ? { left: tip.x, top: tip.y, opacity: 1 } : { opacity: 0 }}>
        {tip && (<><b>{tip.title}</b>{tip.body ? <><br />{tip.body}</> : null}</>)}
      </div>
    </div>
  );
}

function rosette(): string {
  let d = "";
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const r = i % 2 ? 33 : 36;
    d += `${i ? "L" : "M"}${(Math.cos(a) * r).toFixed(2)},${(Math.sin(a) * r).toFixed(2)}`;
  }
  return `${d}Z`;
}

function Traveller({ g, t, label, narrow }: { g: ReturnType<typeof arcGeometry>; t: number; label: string; narrow: boolean }) {
  const p = pointOnArc(g, t);
  const w = Math.max(70, label.length * 6.6 + 18);
  const lx = narrow ? p.x - w / 2 + 10 : p.x - w / 2;
  return (
    <g>
      <g transform={`translate(${p.x},${p.y})`}>
        <circle r="22" fill="var(--t-accent-dim)" />
        <circle r="15" fill="var(--t-heading)" />
        <path d={PLANE} fill="var(--t-bg)" transform={`rotate(${angleOnArc(g, t)})`} />
      </g>
      <rect x={lx} y={p.y + 26} width={w} height="24" rx="6" fill="var(--t-panel)" stroke="var(--t-accent-line)" />
      <text x={lx + 9} y={p.y + 42} fill="var(--t-heading)" style={{ font: "600 11.5px var(--font-sans)" }}>{label}</text>
    </g>
  );
}

function GhostPlane({ g, ghost, width }: { g: ReturnType<typeof arcGeometry>; ghost: { t: number; label: string; fading: boolean }; width: number }) {
  const p = pointOnArc(g, ghost.t);
  const w = Math.max(80, ghost.label.length * 6.6 + 18);
  const lx = Math.min(p.x - w / 2, width - w - 4);
  return (
    <g style={{ opacity: ghost.fading ? 0 : 1, transition: "opacity .6s" }} pointerEvents="none" aria-hidden="true">
      <g transform={`translate(${p.x},${p.y})`}>
        <circle r="15" fill="var(--t-panel)" stroke="var(--t-accent)" strokeWidth="1.6" strokeDasharray="3 3" />
        <path d={PLANE} fill="var(--t-accent)" transform={`rotate(${angleOnArc(g, ghost.t)})`} />
      </g>
      <rect x={lx} y={p.y + 22} width={w} height="24" rx="6" fill="var(--t-accent)" />
      <text x={lx + 9} y={p.y + 38} fill="var(--t-accent-ink)" style={{ font: "600 11.5px var(--font-sans)" }}>{ghost.label}</text>
    </g>
  );
}
