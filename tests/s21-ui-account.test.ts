import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Router } from "wouter";
import { describe, expect, it } from "vitest";
import { AccountAvatar, AccountMenuPanel } from "../client/src/components/os/account-menu";
import { avatarInitials, safePhotoUrl } from "../client/src/lib/avatar";
import { I18nProvider } from "../client/src/i18n";
import { ThemeProvider } from "../client/src/hooks/use-theme";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import { studentOsEn, studentOsFr } from "../client/src/i18n/modules/student-os";

(globalThis as { React?: unknown }).React = React;
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const wrap = (node: React.ReactElement, lang: "en" | "fr" = "en") =>
  renderToStaticMarkup(createElement(ThemeProvider, null, createElement(I18nProvider, { initialLanguage: lang }, createElement(Router, { ssrPath: "/" }, node))));

describe("S21 account avatar", () => {
  it("initials: first+last, one name, display name, email, unknown", () => {
    expect(avatarInitials("amélie", "laurent")).toBe("AL");
    expect(avatarInitials("Amélie", null)).toBe("A");
    expect(avatarInitials(null, "Laurent")).toBe("L");
    expect(avatarInitials(null, null, "Jean Pierre Dupont")).toBe("JD");
    expect(avatarInitials(null, null, "Madonna")).toBe("M");
    expect(avatarInitials(null, null, "", "zed@synthetic.example")).toBe("Z");
    expect(avatarInitials()).toBe("?");
  });
  it("only http(s) or image data URLs are used as a photo source", () => {
    expect(safePhotoUrl("https://x.supabase.co/storage/v1/object/sign/a.png?token=1")).toContain("https://");
    expect(safePhotoUrl("data:image/png;base64,AAAA")).not.toBeNull();
    expect(safePhotoUrl("javascript:alert(1)")).toBeNull();
    expect(safePhotoUrl("data:text/html;base64,AAAA")).toBeNull();
    expect(safePhotoUrl(null)).toBeNull();
    expect(safePhotoUrl("")).toBeNull();
  });
  it("shows initials when there is no photo", () => {
    const html = wrap(createElement(AccountAvatar, { identity: { name: "Amélie Laurent", firstName: "Amélie", lastName: "Laurent" } }));
    expect(html).toContain('data-testid="header-avatar-initials"');
    expect(html).toContain(">AL<");
  });
});

describe("S21 account menu", () => {
  const identity = { studentId: "s1", firstName: "Amélie", lastName: "Laurent", name: "Amélie Laurent", email: "amelie.laurent@synthetic.example", photoUrl: null };
  it("offers My Profile (/profile), Change Photo and Sign Out, and keeps language + theme controls for phones", () => {
    const html = wrap(createElement(AccountMenuPanel, { identity }));
    expect(html).toContain('href="/profile"');
    expect(html).toContain("My Profile");
    expect(html).toContain("Change Photo");
    expect(html).toContain("Sign Out");
    expect(html).toContain('data-testid="language-toggle"');
    expect(html).toContain('data-testid="button-theme-toggle"');
    expect(html).toContain("amelie.laurent@synthetic.example");
  });
  it("Change Photo is disabled until the student record is known", () => {
    const html = wrap(createElement(AccountMenuPanel, { identity: { ...identity, studentId: undefined } }));
    expect(html).toMatch(/<button[^>]*disabled[^>]*data-testid="account-menu-photo"|<button[^>]*data-testid="account-menu-photo"[^>]*disabled/);
  });
  it("is in French", () => {
    const html = wrap(createElement(AccountMenuPanel, { identity }), "fr");
    expect(html).toContain("Mon profil");
    expect(html).toContain("Changer la photo");
    expect(html).toContain("Se déconnecter");
  });
  it("header: one photo cache key shared with the sidebar; a change invalidates header, sidebar and profile", () => {
    const hook = read("client/src/hooks/use-my-student.ts");
    expect(hook).toContain('queryKey: ["/api/students/me", user?.id]');
    expect(read("client/src/components/app-sidebar.tsx")).toContain('queryKey: ["/api/students/me", user?.id]');
    expect(hook).toContain('invalidateQueries({ queryKey: ["/api/students/me"] })');
    expect(hook).toContain("PROFILE_QUERY_KEY");
    expect(read("client/src/hooks/use-student-profile.ts")).toContain('invalidateQueries({ queryKey: ["/api/students/me"] })');
    const shell = read("client/src/components/student-shell.tsx");
    expect(shell).toContain("usePhotoChanged()");
    expect(shell).toContain('<ThemeToggle className="h-11 w-11" />');
  });
  it("staff can change a student's photo from the workspace through the same, unchanged endpoint", () => {
    const ws = read("client/src/pages/admin-student-workspace.tsx");
    expect(ws).toContain("<PhotoDialog");
    expect(ws).toContain("STAFF_PROFILE_QUERY_KEY(identity.id!)");
    expect(read("client/src/components/profile-avatar-upload.tsx")).toContain("/api/students/${encodeURIComponent(studentId)}/photo");
  });
});

describe("S21 student-os i18n", () => {
  it("every English key has a French key (module and merged dictionaries) and the reverse", () => {
    expect(Object.keys(studentOsFr).sort()).toEqual(Object.keys(studentOsEn).sort());
    for (const k of Object.keys(studentOsEn)) {
      expect(k in en, k).toBe(true);
      expect(k in fr, k).toBe(true);
    }
  });
  it("French is a real translation, keeps placeholders, and uses no empty values", () => {
    const allowedSame = new Set<string>(["gs.type.document"]); // "Documents" is the same word in both languages
    for (const [k, v] of Object.entries(studentOsEn)) {
      const f = (studentOsFr as Record<string, string>)[k]!;
      expect(f.trim().length, k).toBeGreaterThan(0);
      expect(v.trim().length, k).toBeGreaterThan(0);
      if (!allowedSame.has(k)) expect(f, k).not.toBe(v);
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
      expect(ph(f), k).toBe(ph(v));
    }
  });
});
