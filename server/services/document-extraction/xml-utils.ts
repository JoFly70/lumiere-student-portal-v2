/** Tiny XML helpers for OOXML parts (no XML dependency; regex scanning over bounded input). */

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeXmlText(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, ent: string) => {
    if (ent[0] === '#') {
      const code = ent[1] === 'x' || ent[1] === 'X' ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code < 0xe000)) return '';
      return String.fromCodePoint(code);
    }
    return ENTITIES[ent] ?? m;
  });
}

export function attr(tag: string, name: string): string | null {
  const m = new RegExp(`(?:^|[\\s<])${name}\\s*=\\s*("([^"]*)"|'([^']*)')`).exec(tag);
  return m ? decodeXmlText(m[2] ?? m[3] ?? '') : null;
}

/** Concatenate the text of every <tagName>…</tagName> element inside `xml` (ignores a:/w: prefix differences). */
export function textOfElements(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)</${tagName}>`, 'g');
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) out += decodeXmlText(m[1]);
  return out;
}
