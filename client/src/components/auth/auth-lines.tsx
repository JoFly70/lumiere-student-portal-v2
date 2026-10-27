/** Architectural line-work for the brand panel: a rising halo over a colonnade of arches. Decorative. */
export function AuthLines() {
  const gold = "#c8ae76";
  // Arches: x centre, half-width, spring-line y, base y.
  const arches = [
    { x: 330, w: 70, top: 520 },
    { x: 520, w: 70, top: 520 },
    { x: 710, w: 70, top: 520 },
  ];
  return (
    <svg className="auth-hero-lines" viewBox="0 0 900 900" preserveAspectRatio="xMaxYMax slice" aria-hidden="true" focusable="false" fill="none" stroke={gold}>
      <g strokeWidth="1" strokeOpacity=".16">
        {[...Array(8)].map((_, i) => (
          <line key={i} x1={160 + i * 100} y1="0" x2={160 + i * 100} y2="900" />
        ))}
      </g>
      <g strokeWidth="1" strokeOpacity=".35">
        {[300, 380, 460, 540].map((r, i) => (
          <path key={r} className="auth-draw" style={{ ["--d" as string]: `${i * 220}ms` }} pathLength={1} d={`M ${520 - r} 520 A ${r} ${r} 0 0 1 ${520 + r} 520`} />
        ))}
      </g>
      <g strokeWidth="1.2" strokeOpacity=".6">
        {arches.map((a, i) => (
          <g key={a.x}>
            <path className="auth-draw" style={{ ["--d" as string]: `${600 + i * 250}ms` }} pathLength={1} d={`M ${a.x - a.w} 900 V ${a.top} A ${a.w} ${a.w} 0 0 1 ${a.x + a.w} ${a.top} V 900`} />
            <path className="auth-draw" style={{ ["--d" as string]: `${800 + i * 250}ms` }} pathLength={1} strokeOpacity=".5" d={`M ${a.x - a.w + 18} 900 V ${a.top} A ${a.w - 18} ${a.w - 18} 0 0 1 ${a.x + a.w - 18} ${a.top} V 900`} />
          </g>
        ))}
        <line x1="150" y1="560" x2="900" y2="560" strokeOpacity=".3" />
        <line x1="150" y1="520" x2="900" y2="520" strokeOpacity=".2" />
      </g>
    </svg>
  );
}
