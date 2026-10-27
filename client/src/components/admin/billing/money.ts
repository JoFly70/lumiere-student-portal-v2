/**
 * Money input helpers for the staff billing UI. Pure string arithmetic: no parseFloat, no float drift.
 * Amounts are integer minor units (cents); the exponent comes from the currency (USD 2, JPY 0).
 */
import { MAX_CENTS, currencyExponent } from "@shared/billing-contract";

/**
 * "1,250.50" -> 125050. Accepts digits with an optional single decimal separator and thousands commas/spaces.
 * Returns null for empty, negative, zero, too many decimals, non-numeric or above MAX_CENTS input.
 */
export function parseMoneyToCents(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const text = input.trim().replace(/[\s,_]/g, "");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!m) return null;
  const whole = m[1]!;
  const frac = m[2] ?? "";
  if (frac.length > exp) return null;
  const digits = (whole + frac.padEnd(exp, "0")).replace(/^0+(?=\d)/, "");
  if (digits.length > 15) return null;
  const cents = Number(digits);
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > MAX_CENTS) return null;
  return cents;
}

/** 125050 -> "1250.50" (plain, for prefilling an input). */
export function centsToInput(cents: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(cents);
  const s = String(cents).padStart(exp + 1, "0");
  return `${s.slice(0, -exp)}.${s.slice(-exp)}`;
}
