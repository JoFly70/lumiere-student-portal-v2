import { describe, expect, it, vi } from "vitest";
import { en } from "../client/src/i18n/en";
import { fr } from "../client/src/i18n/fr";
import {
  LANGUAGE_STORAGE_KEY, formatCreditsLocale, readStoredLanguage, translate, writeStoredLanguage,
} from "../client/src/i18n";

describe("S18 i18n dictionaries", () => {
  it("fr has every en key and no extras", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });
  it("no empty values in either language", () => {
    for (const [k, v] of Object.entries({ ...en })) expect(v.trim(), `en.${k}`).not.toBe("");
    for (const [k, v] of Object.entries(fr)) expect(v.trim(), `fr.${k}`).not.toBe("");
  });
  it("fr keeps the same {placeholders} as en", () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join(",");
    for (const k of Object.keys(en) as Array<keyof typeof en>) expect(ph(fr[k]), k).toBe(ph(en[k]));
  });
  it("covers the required namespaces", () => {
    for (const ns of ["nav.", "flightDeck.", "billing.", "support.", "academic."]) {
      expect(Object.keys(en).some((k) => k.startsWith(ns)), ns).toBe(true);
    }
  });
});

describe("S18 i18n persistence", () => {
  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    expect(readStoredLanguage(storage)).toBe("en");
    expect(writeStoredLanguage("fr", storage)).toBe(true);
    expect(store.get(LANGUAGE_STORAGE_KEY)).toBe("fr");
    expect(readStoredLanguage(storage)).toBe("fr");
  });
  it("ignores invalid stored values", () => {
    expect(readStoredLanguage({ getItem: () => "de" })).toBe("en");
  });
  it("survives failing localStorage", () => {
    const boom = () => { throw new Error("blocked"); };
    expect(readStoredLanguage({ getItem: boom })).toBe("en");
    expect(writeStoredLanguage("fr", { setItem: boom })).toBe(false);
    vi.stubGlobal("localStorage", { getItem: boom, setItem: boom });
    expect(readStoredLanguage()).toBe("en");
    expect(writeStoredLanguage("fr")).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe("S18 translate", () => {
  it("returns the translation per language", () => {
    expect(translate("en", "nav.billing")).toBe("Billing");
    expect(translate("fr", "nav.billing")).toBe("Facturation");
  });
  it("falls back to the key for unknown keys, and to English for keys missing in fr", () => {
    expect(translate("fr", "does.not.exist")).toBe("does.not.exist");
    (en as Record<string, string>)["test.onlyEn"] = "Only English";
    expect(translate("fr", "test.onlyEn")).toBe("Only English");
    delete (en as Record<string, string>)["test.onlyEn"];
  });
  it("interpolates {name} and leaves unknown placeholders intact", () => {
    expect(translate("en", "flightDeck.greeting", { name: "Léa" })).toBe("Hello, Léa");
    expect(translate("fr", "flightDeck.greeting", { name: "Léa" })).toBe("Bonjour Léa");
    expect(translate("en", "flightDeck.greeting", {})).toBe("Hello, {name}");
  });
  it("uses a decimal comma for French credits", () => {
    expect(formatCreditsLocale(1, "fr")).toBe("0,5");
    expect(formatCreditsLocale(1, "en")).toBe("0.5");
    expect(formatCreditsLocale(5, "fr")).toBe("2,5");
    expect(formatCreditsLocale(4, "fr")).toBe("2");
    expect(formatCreditsLocale(-1, "fr")).toBe("-0,5");
  });
});
