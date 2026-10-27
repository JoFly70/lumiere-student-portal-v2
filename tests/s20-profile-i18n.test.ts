import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { pt } from "../client/src/components/profile/pt";
import { PROFILE_SECTIONS, FIELD_LABELS, describeError, evidenceChip, verificationChip, authorityChip, SCOPE_INFO, validatePhone } from "../client/src/components/profile/profile-presentation";
import { profileFr } from "../client/src/i18n/modules/profile";
import { cockpitEn, cockpitFr } from "../client/src/i18n/modules/cockpit";

const DIR = resolve(process.cwd(), "client/src/components/profile");
const files = [
  ...readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && f !== "pt.ts"),
  "../profile-avatar-upload.tsx",
];

/** Every string literal inside the first argument of a pt(...) call. */
function phrases(): Set<string> {
  const out = new Set<string>();
  for (const f of files) {
    const s = readFileSync(resolve(DIR, f), "utf8");
    for (const m of s.matchAll(/\bpt\(/g)) {
      let i = m.index! + m[0].length, depth = 1, first = true;
      while (i < s.length && depth > 0) {
        const c = s[i]!;
        if (c === '"') {
          let j = i + 1;
          while (s[j] !== '"') { if (s[j] === "\\") j++; j++; }
          if (first) out.add(JSON.parse(s.slice(i, j + 1)) as string);
          i = j;
        } else if (c === "`") i = s.indexOf("`", i + 1);
        else if ("([{".includes(c)) depth++;
        else if (")]}".includes(c)) depth--;
        else if (c === "," && depth === 1) first = false;
        i++;
      }
    }
  }
  for (const s of PROFILE_SECTIONS) out.add(s.label);
  return out;
}

describe("S20 profile French", () => {
  const used = phrases();
  it("every pt() phrase used by the profile has a French entry", () => {
    expect([...used].filter((p) => !(p in profileFr))).toEqual([]);
  });
  it("no orphaned French entries", () => {
    expect(Object.keys(profileFr).filter((k) => !used.has(k))).toEqual([]);
  });
  it("French differs from English except allow-listed loanwords", () => {
    const ALLOWED = new Set(["Parent", "WhatsApp", "GED", "Classification", "documents"]);
    expect(Object.entries(profileFr).filter(([k, v]) => k === v && !ALLOWED.has(k)).map(([k]) => k)).toEqual([]);
  });
  it("placeholders survive translation", () => {
    for (const [k, v] of Object.entries(profileFr)) {
      expect([...(v.match(/\{\w+\}/g) ?? [])].sort(), k).toEqual([...(k.match(/\{\w+\}/g) ?? [])].sort());
    }
  });
  it("English output is the original copy; French is translated with typographic spacing", () => {
    expect(pt("Your profile at a glance")).toBe("Your profile at a glance");
    expect(pt("Submitted {date}. Nothing.", { date: "x" })).toBe("Submitted x. Nothing.");
    expect(pt("Your profile at a glance", undefined, "fr")).toBe("Votre profil en un coup d’œil");
    expect(pt("Legal name:", undefined, "fr")).toBe("Nom légal :");
    expect(pt("Identity: {status}", { status: "Vérifié" }, "fr")).toBe("Identité : Vérifié");
  });
  it("label tables stay language-aware", () => {
    expect(FIELD_LABELS.dob).toBe("Date of birth");
    expect(SCOPE_INFO.academic.label).toBe("Academic records");
    expect(evidenceChip("verified").label).toBe("Verified");
    expect(verificationChip("pending").label).toBe("Under review");
    expect(authorityChip("pending_verification").label).toBe("Verification pending");
    expect(validatePhone("", true)).toBe("Enter a phone number");
    expect(describeError(null)).toBe("Something went wrong. Please try again.");
  });
});

describe("S20 cockpit wording", () => {
  it("'left to confirm' became 'not yet official' (credits not official include unstarted ones)", () => {
    expect(cockpitEn["cockpit.hero.left"]).toBe("{n} credits not yet official");
    expect(cockpitFr["cockpit.hero.left"]).toBe("{n} crédits pas encore officiels");
    expect(cockpitEn["cockpit.hero.leftOne"]).toContain("not yet official");
    expect(cockpitFr["cockpit.hero.leftOne"]).toBe("{n} crédit pas encore officiel");
    expect(JSON.stringify(cockpitEn)).not.toContain("left to confirm");
    expect(JSON.stringify(cockpitFr)).not.toContain("Reste à confirmer");
  });
});
