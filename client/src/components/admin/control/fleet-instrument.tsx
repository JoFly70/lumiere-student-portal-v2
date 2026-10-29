/**
 * "All flights": the student Flight Deck instrument for the owner. Same quadratic route (lib/s27/cockpit-model),
 * same plane glyph and diploma seal as the student cockpit, but one plane per student, placed at
 * school-confirmed credits / credits required. Demo students fly as dashed "ghost" planes (as the student's
 * what-if plane does) and say "Demo" in their label. Students with no confirmed credit yet, or no credit target,
 * wait "on the ground" as chips under the map. Every plane is a real link (HTML, keyboard focusable) laid over the
 * SVG, so it is announced with its name, credits and status and opens the file (admin) or the allowed page (staff).
 */
import React, { useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "wouter";
import type { ControlStudentRow } from "@shared/s27-contract";
import crestUrl from "@/assets/brand/crest-96.webp";
import { useT } from "@/i18n";
import { PLANE, rosette } from "@/components/s27/flight-instrument";
import { angleOnArc, arcGeometry, arcPath, pointOnArc } from "@/lib/s27/cockpit-model";
import { creditsFraction, fleetLanes } from "@/lib/owner-presentation";

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

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

export interface FleetProps {
  readonly rows: readonly ControlStudentRow[];
  readonly hrefOf: (row: ControlStudentRow) => string;
}

export function FleetInstrument({ rows, hrefOf }: FleetProps) {
  const { t } = useT();
  const mapRef = useRef<HTMLDivElement>(null);
  const width = useWidth(mapRef);
  const uid = useId().replace(/:/g, "");
  const height = width > 0 && width < 620 ? 250 : 290;
  const g = width > 0 ? arcGeometry(width, height) : null;

  const flying = useMemo(() => rows.filter((r) => (r.creditsRequired ?? 0) > 0 && r.creditsConfirmed > 0), [rows]);
  const ground = useMemo(() => rows.filter((r) => !((r.creditsRequired ?? 0) > 0 && r.creditsConfirmed > 0)), [rows]);
  const lanes = useMemo(() => (g ? fleetLanes(flying.map((r) => pointOnArc(g, creditsFraction(r.creditsConfirmed, r.creditsRequired)).x), 30) : []), [g, flying]);
  const [tip, setTip] = useState<{ x: number; y: number; title: string; body: string } | null>(null);

  const real = rows.filter((r) => !r.isDemo);
  const info = [
    { k: "flying", v: real.filter((r) => flying.includes(r)).length, label: t("owner.fleet.info.flying"), hint: t("owner.fleet.info.flyingHint") },
    { k: "ground", v: real.filter((r) => ground.includes(r)).length, label: t("owner.fleet.info.ground"), hint: t("owner.fleet.info.groundHint") },
    { k: "final", v: real.filter((r) => flying.includes(r) && creditsFraction(r.creditsConfirmed, r.creditsRequired) >= 0.75).length, label: t("owner.fleet.info.final"), hint: t("owner.fleet.info.finalHint") },
    { k: "demo", v: rows.length - real.length, label: t("owner.fleet.info.demo"), hint: t("owner.fleet.info.demoHint") },
  ];

  const narrow = g?.narrow ?? false;
  const sealScale = narrow ? 0.55 : 0.72;

  return (
    <section className="card flight occ-fleet" aria-labelledby="cc-fleet-h" data-testid="cc-fleet" id="cc-fleet">
      <div className="ch">
        <div>
          <span className="eyebrow">{t("owner.fleet.eyebrow")}</span>
          <h2 id="cc-fleet-h">{t("owner.fleet.title")}</h2>
        </div>
        <div className="legend" aria-hidden="true">
          <span><i className="occ-lg real" />{t("owner.fleet.legend.real")}</span>
          <span><i className="occ-lg demo" />{t("owner.fleet.legend.demo")}</span>
        </div>
      </div>
      <div className="map occ-map" ref={mapRef} role="group" aria-label={t("owner.fleet.aria")} style={{ height }} onMouseLeave={() => setTip(null)}>
        {g && (
          <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden="true">
            <defs>
              <linearGradient id={`${uid}gold`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#F6E3B4" /><stop offset=".45" stopColor="#D2AE66" /><stop offset="1" stopColor="#8E6A2B" /></linearGradient>
              <radialGradient id={`${uid}halo`}><stop offset="0" stopColor="#E9C77F" stopOpacity=".45" /><stop offset="1" stopColor="#E9C77F" stopOpacity="0" /></radialGradient>
            </defs>
            <line x1={g.A.x - 14} x2={g.B.x} y1={g.base} y2={g.base} stroke="var(--t-line-2)" />
            <path d={arcPath(g, 0, 1)} fill="none" stroke="var(--t-line-3)" strokeWidth="2" strokeDasharray="2 7" strokeLinecap="round" />
            {[0.25, 0.5, 0.75].map((f) => {
              const p = pointOnArc(g, f);
              const crowded = flying.some((r) => Math.abs(pointOnArc(g, creditsFraction(r.creditsConfirmed, r.creditsRequired)).x - p.x) < 26);
              return (
                <g key={f}>
                  <circle cx={p.x} cy={p.y} r="4" fill="var(--t-panel)" stroke="var(--t-line-3)" strokeWidth="1.5" />
                  {!crowded && <text x={p.x} y={p.y + 20} textAnchor="middle" fill="var(--t-muted)" style={{ font: "600 10px var(--font-sans)", letterSpacing: ".08em" }}>{Math.round(f * 100)}%</text>}
                </g>
              );
            })}
            {/* contrails: a short gold trail behind every plane */}
            {flying.map((r, i) => {
              const f = creditsFraction(r.creditsConfirmed, r.creditsRequired);
              const t0 = Math.max(0, f - 0.09);
              return <path key={r.studentId} d={arcPath(g, t0, f, 12)} fill="none" stroke={r.isDemo ? "var(--t-line-3)" : "var(--t-accent)"} strokeOpacity={r.isDemo ? 0.6 : 0.85} strokeWidth="3" strokeLinecap="round" strokeDasharray={r.isDemo ? "3 4" : undefined} />;
            })}
            <circle cx={g.A.x} cy={g.A.y} r="6" fill="var(--t-accent)" />
            <text x={g.A.x} y={g.A.y + 24} textAnchor={narrow ? "start" : "middle"} fill="var(--t-heading)" style={{ font: "600 12px var(--font-sans)" }}>{t("owner.fleet.start")}</text>
            <g transform={`translate(${g.B.x},${g.B.y}) scale(${sealScale})`}>
              <circle r="62" fill={`url(#${uid}halo)`} />
              <path d="M-14,22 L-26,62 L-16,56 L-9,66 L-2,28Z" fill="#9E2B2B" />
              <path d="M14,22 L26,62 L16,56 L9,66 L2,28Z" fill="#7E1F22" />
              <path d={rosette()} fill={`url(#${uid}gold)`} />
              <circle r="24" fill="var(--t-panel)" stroke="#B48A45" strokeWidth="1" />
              <image href={crestUrl} x="-14" y="-15" width="28" height="29" />
            </g>
            <text x={narrow ? width - 10 : g.B.x} y={g.B.y + (narrow ? 52 : 66)} textAnchor={narrow ? "end" : "middle"} fill="var(--t-heading)" style={{ font: `500 ${narrow ? 15 : 18}px var(--font-display)` }}>{t("owner.fleet.end")}</text>
            <text x={narrow ? width - 10 : g.B.x} y={g.B.y + (narrow ? 66 : 82)} textAnchor={narrow ? "end" : "middle"} fill="var(--t-accent-text)" style={{ font: "600 9.5px var(--font-sans)", letterSpacing: ".12em", textTransform: "uppercase" }}>{t("owner.fleet.endSub")}</text>
          </svg>
        )}
        {g && (
          <ul className="occ-planes" aria-label={t("owner.fleet.listLabel")}>
            {flying.map((r, i) => {
              const f = creditsFraction(r.creditsConfirmed, r.creditsRequired);
              const p = pointOnArc(g, f);
              const y = p.y + (lanes[i] ?? 0);
              const credits = t("owner.fleet.tipCredits", { a: r.creditsConfirmed, b: r.creditsRequired ?? "—" });
              const name = r.isDemo ? `${r.name} · ${t("owner.demo")}` : r.name;
              const show = () => setTip({ x: p.x, y: y - 22, title: name, body: `${credits} · ${r.status.label}` });
              return (
                <li key={r.studentId} style={{ left: p.x, top: y }}>
                  <Link href={hrefOf(r)} className={r.isDemo ? "occ-plane demo" : "occ-plane"} data-testid="fleet-plane" data-demo={r.isDemo ? "true" : "false"} data-fraction={f.toFixed(2)}
                    aria-label={t("owner.fleet.planeLabel", { name, credits, status: r.status.label })}
                    onMouseEnter={show} onFocus={show} onBlur={() => setTip(null)}>
                    <svg viewBox="-13 -13 26 26" width="26" height="26" aria-hidden="true"><path d={PLANE} transform={`rotate(${angleOnArc(g, f).toFixed(1)})`} /></svg>
                    <span className="occ-tag" aria-hidden="true">{initials(r.name)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        <div className="tip" role="status" style={tip ? { left: tip.x, top: tip.y, opacity: 1 } : { opacity: 0 }}>
          {tip && (<><b>{tip.title}</b><br />{tip.body}</>)}
        </div>
      </div>
      {ground.length > 0 && (
        <div className="occ-ground" data-testid="fleet-ground">
          <span className="lbl">{t("owner.fleet.ground")}</span>
          {ground.map((r) => (
            <Link key={r.studentId} href={hrefOf(r)} className="chipbtn" data-testid="fleet-ground-student" style={{ "--sev": r.isDemo ? "var(--t-line-3)" : "var(--t-accent)" } as React.CSSProperties}>
              <i />
              <span>{r.name}</span>
              {r.isDemo ? <span className="occ-demo">{t("owner.demo")}</span> : null}
              <span className="occ-muted">{(r.creditsRequired ?? 0) > 0 ? t("owner.fleet.tipCredits", { a: r.creditsConfirmed, b: r.creditsRequired ?? "—" }) : t("owner.fleet.noRoute")}</span>
            </Link>
          ))}
        </div>
      )}
      <dl className="info">
        {info.map((x) => (
          <div key={x.k} data-testid={`fleet-info-${x.k}`}>
            <dt className="eyebrow occ-k">{x.label}</dt>
            <dd className="v">{x.v}<small>{x.hint}</small></dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
