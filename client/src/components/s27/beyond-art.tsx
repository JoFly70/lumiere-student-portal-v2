/**
 * Illustrated art for the Beyond page: postcard scenes (chosen by index, no external images) and the hero skyline.
 * Deterministic: the "random" buildings and stars come from a seeded generator, so renders are stable.
 */
import React from "react";
import type { ArtKind } from "@/lib/s27/beyond-model";

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function PostcardArt({ kind, id }: { kind: ArtKind; id: string }) {
  const sky = `${id}s`;
  const water = `${id}w`;
  if (kind === "lake") {
    return (
      <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs>
          <linearGradient id={sky} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2b2f55" /><stop offset=".55" stopColor="#c9775a" /><stop offset=".8" stopColor="#f2c47e" /></linearGradient>
          <linearGradient id={water} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#e8a86e" /><stop offset="1" stopColor="#2a2c4a" /></linearGradient>
        </defs>
        <rect width="400" height="250" fill={`url(#${sky})`} />
        <circle cx="270" cy="128" r="26" fill="#ffe2a6" opacity=".9" />
        <path d="M0 150 L60 112 L120 140 L190 96 L250 132 L320 104 L400 138 L400 170 L0 170Z" fill="#3b3157" opacity=".85" />
        <path d="M0 162 L80 136 L150 158 L230 128 L300 152 L400 132 L400 175 L0 175Z" fill="#2a2546" />
        <rect y="168" width="400" height="82" fill={`url(#${water})`} />
        <path d="M230 176 h80 M250 186 h50 M240 198 h70 M262 210 h30" stroke="#ffe2a6" strokeWidth="2" opacity=".55" />
        <path d="M40 168 v-16 h10 v-8 h14 v8 h10 v16Z M330 168 v-22 h8 v-6 h6 v6 h8 v22Z" fill="#1e1a33" />
      </svg>
    );
  }
  if (kind === "city") {
    const r = rng(3);
    const parts: React.ReactNode[] = [];
    let x = 0;
    let k = 0;
    while (x < 400) {
      const w = 22 + r() * 34;
      const h = 60 + r() * 130;
      parts.push(<rect key={`b${k++}`} x={x.toFixed(0)} y={(250 - h).toFixed(0)} width={w.toFixed(0)} height={h.toFixed(0)} fill={r() < 0.5 ? "#171c3a" : "#1f2550"} />);
      for (let wy = 250 - h + 10; wy < 240; wy += 12) {
        for (let wx = x + 5; wx < x + w - 6; wx += 9) {
          if (r() < 0.38) parts.push(<rect key={`w${k++}`} x={wx.toFixed(0)} y={wy.toFixed(0)} width="4" height="5" fill="#f6d28e" opacity={(0.5 + r() * 0.5).toFixed(2)} />);
        }
      }
      x += w + 2;
    }
    return (
      <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
        <defs><linearGradient id={sky} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0f1630" /><stop offset=".6" stopColor="#3a3a78" /><stop offset="1" stopColor="#8e6aa8" /></linearGradient></defs>
        <rect width="400" height="250" fill={`url(#${sky})`} />
        {parts}
        <circle cx="320" cy="50" r="16" fill="#f3e6c4" opacity=".85" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 400 250" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs><linearGradient id={sky} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9fc0d6" /><stop offset=".6" stopColor="#f3dcae" /><stop offset="1" stopColor="#e9c48a" /></linearGradient></defs>
      <rect width="400" height="250" fill={`url(#${sky})`} />
      <circle cx="90" cy="70" r="30" fill="#fff4d6" opacity=".8" />
      <path d="M0 190 C80 120 170 100 250 130 C310 150 360 140 400 120 L400 250 L0 250Z" fill="#5c7a52" />
      <path d="M0 215 C100 185 210 190 300 205 C350 212 380 205 400 200 L400 250 L0 250Z" fill="#3f5a3c" />
      <rect x="196" y="78" width="22" height="70" fill="#e8dcc4" />
      <rect x="200" y="62" width="14" height="18" fill="#efe5cf" />
      <rect x="204" y="52" width="6" height="12" fill="#f4ecd9" />
      <rect x="150" y="122" width="116" height="30" fill="#ded0b4" />
      <path d="M200 90 h14 M200 102 h14 M200 114 h14" stroke="#b8a888" strokeWidth="2" />
    </svg>
  );
}

export function BeyondSky() {
  const r = rng(11);
  const stars = Array.from({ length: 90 }, (_, i) => (
    <circle key={`s${i}`} cx={(r() * 1200).toFixed(0)} cy={(r() * 220).toFixed(0)} r={(r() * 1.2 + 0.3).toFixed(1)} fill="#f3eee4" opacity={(r() * 0.6 + 0.2).toFixed(2)} />
  ));
  const city: React.ReactNode[] = [];
  let x = 620;
  let k = 0;
  while (x < 1200) {
    const w = 20 + r() * 36;
    let hh = 40 + r() * 120;
    if (x > 880 && x < 940) hh = 190;
    city.push(<rect key={`c${k++}`} x={x.toFixed(0)} y={(420 - hh).toFixed(0)} width={w.toFixed(0)} height={hh.toFixed(0)} fill="#151c30" />);
    for (let wy = 420 - hh + 8; wy < 410; wy += 11) {
      for (let wx = x + 4; wx < x + w - 5; wx += 8) {
        if (r() < 0.3) city.push(<rect key={`w${k++}`} x={wx.toFixed(0)} y={wy.toFixed(0)} width="3" height="4" fill="#f2cf8a" opacity={(r() * 0.6 + 0.3).toFixed(2)} />);
      }
    }
    x += w + 3;
  }
  return (
    <svg className="bd-sky" viewBox="0 0 1200 420" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs><radialGradient id="bdglow" cx=".72" cy=".9" r=".6"><stop offset="0" stopColor="#e9c77f" stopOpacity=".45" /><stop offset="1" stopColor="#e9c77f" stopOpacity="0" /></radialGradient></defs>
      <rect width="1200" height="420" fill="url(#bdglow)" />
      {stars}
      <path d="M0 360 C150 300 260 290 360 320 C430 340 470 300 560 300 C640 300 700 340 760 330 L760 420 L0 420Z" fill="#1b2238" />
      {city}
      <path d="M0 420 L0 392 C300 372 600 380 1200 398 L1200 420Z" fill="#0a0f1b" />
      <path d="M180 312 l0 -26 m-8 8 h16" stroke="#e9c77f" strokeWidth="2" opacity=".8" />
    </svg>
  );
}
