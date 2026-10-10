/**
 * RFC 5545 text rules: TEXT escaping (3.3.11) and line folding (3.1). Pure.
 */

const encoder = new TextEncoder();
const MAX_OCTETS = 75;

/** Escapes a TEXT value: `\` `;` `,` and line breaks. Control characters other than tab are removed. */
export function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r/g, "\n")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\n/g, "\\n");
}

/**
 * Folds one content line so that no physical line is longer than 75 octets (without its CRLF).
 * A continuation line starts with one space. Cuts only between code points, so a multibyte
 * character or an emoji (a surrogate pair) is never cut.
 */
export function foldLine(line: string): string {
  const parts: string[] = [];
  let current = "";
  let size = 0;
  for (const char of line) {
    const charSize = encoder.encode(char).length;
    if (size + charSize > MAX_OCTETS) {
      parts.push(current);
      current = " ";
      size = 1;
    }
    current += char;
    size += charSize;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/**
 * One content line, `NAME;PARAM=value:VALUE`, not folded. `value` must already be escaped if it is
 * TEXT. Parameter values are quoted if they contain `:`, `;`, or `,`.
 */
export function contentLine(name: string, value: string, params: Record<string, string> = {}): string {
  const paramText = Object.entries(params)
    .map(([key, param]) => `;${key}=${/[:;,]/.test(param) ? `"${param.replace(/"/g, "")}"` : param}`)
    .join("");
  return `${name}${paramText}:${value}`;
}

/** Folds every line and joins them with CRLF. The last line also ends with CRLF. */
export function icsFile(lines: string[]): string {
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
