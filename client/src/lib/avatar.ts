/** Initials for the circular account avatar when there is no photo. Pure. */
export function avatarInitials(first?: string | null, last?: string | null, fallbackName?: string | null, email?: string | null): string {
  const f = first?.trim() ?? "";
  const l = last?.trim() ?? "";
  const letter = (s: string) => Array.from(s)[0]?.toLocaleUpperCase() ?? "";
  if (f && l) return letter(f) + letter(l);
  if (f || l) return letter(f || l);
  const parts = (fallbackName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return letter(parts[0]!) + letter(parts[parts.length - 1]!);
  if (parts.length === 1) return letter(parts[0]!);
  const e = email?.trim() ?? "";
  return e ? letter(e) : "?";
}

/** Only an https/http/data:image URL (the signed photo URL or the demo data URL) is ever used as an image source. */
export function safePhotoUrl(url: unknown): string | null {
  if (typeof url !== "string" || !url) return null;
  return /^(https?:\/\/|data:image\/(png|jpe?g|webp);base64,)/i.test(url) ? url : null;
}
