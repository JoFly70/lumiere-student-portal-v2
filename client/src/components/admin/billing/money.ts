/**
 * Money input helpers for the staff billing UI. Pure string arithmetic: no parseFloat, no float drift.
 * Amounts are integer minor units (cents); the exponent comes from the currency (USD 2, JPY 0).
 */
import { MAX_CENTS, currencyExponent } from "@shared/billing-contract";

/**
 * "1,250.50" -> 125050, and the French forms "1 250,50" / "900,50" -> 125050 / 90050.
 * The last "." or "," is the decimal mark when 1..exponent digits follow it; any other comma or dot must
 * separate thousands in groups of three. A lone dot before three digits ("1.234") is ambiguous and refused. Spaces (including non-breaking) and underscores are ignored.
 * Returns null for empty, negative, zero, ambiguous, too many decimals, non-numeric or above MAX_CENTS input.
 */
export function parseMoneyToCents(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const text = input.trim().replace(/[\s\u00a0\u202f_]/g, "");
  if (!/^\d[\d.,]*$/.test(text)) return null;
  let whole = text;
  let frac = "";
  const last = Math.max(text.lastIndexOf("."), text.lastIndexOf(","));
  if (last >= 0) {
    const tail = text.slice(last + 1);
    const head = text.slice(0, last);
    const decimal = text[last]!;
    // A single mark followed by exactly three digits is a thousands separator ("1,500" or "1.500").
    const isDecimal = /^\d+$/.test(tail) && tail.length >= 1 && tail.length <= Math.max(exp, 0) && exp > 0;
    if (isDecimal) {
      if (head.includes(decimal)) return null; // "1,2,50" or "1.2.50"
      whole = head;
      frac = tail;
    } else if (tail.length !== 3) {
      return null;
    } else if (decimal === "." && !text.includes(",") && text.indexOf(".") === last) {
      return null; // a lone "1.234" could be three decimals or a thousands dot: ambiguous, so refuse it
    }
    const sep = isDecimal ? (decimal === "." ? "," : ".") : text[last]!;
    if (/[.,]/.test(whole)) {
      if (whole.replace(new RegExp(`\\${sep}`, "g"), "").match(/[.,]/)) return null;
      if (!new RegExp(`^\\d{1,3}(\\${sep}\\d{3})*$`).test(whole)) return null;
      whole = whole.split(sep).join("");
    }
  }
  if (!/^\d+$/.test(whole) || (frac && !/^\d+$/.test(frac))) return null;
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
