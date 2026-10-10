import { describe, expect, it } from "vitest";
import { contentLine, escapeText, foldLine, icsFile } from "./ics-text";

const octets = (text: string) => new TextEncoder().encode(text).length;

describe("escapeText", () => {
  it("escapes backslash, semicolon, comma, and line breaks", () => {
    expect(escapeText("a\\b;c,d\r\ne\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
  });

  it("removes control characters but keeps tabs", () => {
    expect(escapeText("a\u0000b\u0007c\td")).toBe("abc\td");
  });
});

describe("foldLine", () => {
  it("a line of 75 octets is not folded; 76 octets is folded", () => {
    expect(foldLine("A".repeat(75))).toBe("A".repeat(75));
    expect(foldLine("A".repeat(76))).toBe(`${"A".repeat(75)}\r\n A`);
  });

  it("counts UTF-8 octets and never cuts inside a multibyte character or an emoji", () => {
    const text = `SUMMARY:${"é🚲".repeat(30)}`;
    const folded = foldLine(text);
    const lines = folded.split("\r\n");
    for (const line of lines) expect(octets(line)).toBeLessThanOrEqual(75);
    // Unfold (remove CRLF + one space) gives the same text back, with no broken characters.
    expect(folded.replace(/\r\n /g, "")).toBe(text);
    expect(lines.every((line) => !line.includes("�"))).toBe(true);
    for (const line of lines) {
      // A lone surrogate would mean an emoji was cut in half.
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(line)).toBe(false);
    }
  });
});

describe("icsFile", () => {
  it("every line ends with CRLF, also the last line, and no physical line is over 75 octets", () => {
    const file = icsFile([
      "BEGIN:VCALENDAR",
      contentLine("X-LONG", "x".repeat(300)),
      contentLine("DTSTART", "20261014", { VALUE: "DATE" }),
      "END:VCALENDAR",
    ]);
    expect(file.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(file.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    for (const line of file.split("\r\n")) expect(octets(line)).toBeLessThanOrEqual(75);
    expect(file).toContain("DTSTART;VALUE=DATE:20261014\r\n");
  });
});
