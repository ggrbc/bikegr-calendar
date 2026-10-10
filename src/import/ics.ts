/**
 * A small RFC 5545 reader for the Tockify feed. It returns the raw properties of each `VEVENT`.
 * It does not interpret dates or text; callers use {@link textValue} for text properties.
 *
 * Why not a library: we need only `VEVENT` properties and the raw `X-TKF-*` parameters, and the
 * feed is machine-made. See docs/plans/occurrence-engine-and-import.md.
 */

export interface IcsProperty {
  /** Upper case, for example `DTSTART` or `X-TKF-PROMOTION-BUTTON`. */
  name: string;
  /** Parameter names in lower case, values without quotes. */
  params: Record<string, string>;
  /** Raw value: ICS escapes are still in it. */
  value: string;
}

export interface IcsEvent {
  properties: IcsProperty[];
}

/**
 * Reads every `VEVENT` in a calendar. Give bytes when you can: a fold can split a multi-byte UTF-8
 * character, and only the byte form can join it correctly.
 */
export function parseIcsEvents(input: string | Uint8Array): IcsEvent[] {
  const text = typeof input === "string" ? unfoldText(input) : unfoldBytes(input);
  const events: IcsEvent[] = [];
  const open: string[] = [];
  let current: IcsEvent | null = null;
  let eventDepth = -1;

  for (const line of text.split(/\r?\n/)) {
    if (line === "") continue;
    const property = parseLine(line);
    if (property.name === "BEGIN") {
      open.push(property.value.toUpperCase());
      if (!current && open.at(-1) === "VEVENT") {
        current = { properties: [] };
        eventDepth = open.length;
      }
    } else if (property.name === "END") {
      if (current && open.length === eventDepth) {
        events.push(current);
        current = null;
      }
      open.pop();
    } else if (current && open.length === eventDepth) {
      // Properties of components inside the VEVENT (for example VALARM) are skipped.
      current.properties.push(property);
    }
  }
  return events;
}

export function firstProperty(event: IcsEvent, name: string): IcsProperty | undefined {
  return event.properties.find((property) => property.name === name);
}

/** Removes ICS text escapes: `\n` or `\N` (new line), `\,`, `\;`, and `\\`. */
export function textValue(raw: string): string {
  return raw.replace(/\\([\\;,nN])/g, (_match, char: string) =>
    char === "n" || char === "N" ? "\n" : char,
  );
}

/**
 * Splits a comma list of text values (such as `CATEGORIES`) at commas that are not escaped, then
 * removes the escapes from each item. A scanner, so `A\\,B` (escaped backslash, then a comma) is
 * two items.
 */
export function textListValue(raw: string): string[] {
  const items: string[] = [];
  let item = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length) {
      item += raw[i] + raw[i + 1];
      i++;
    } else if (raw[i] === ",") {
      items.push(item);
      item = "";
    } else {
      item += raw[i];
    }
  }
  items.push(item);
  return items.map(textValue);
}

/** A line break followed by one space or tab is a fold. */
function unfoldText(text: string): string {
  return text.replace(/\r?\n[ \t]/g, "");
}

function unfoldBytes(bytes: Uint8Array): string {
  const kept: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    const isCrlfFold = bytes[i] === 0x0d && bytes[i + 1] === 0x0a && isSpaceOrTab(bytes[i + 2]);
    const isLfFold = bytes[i] === 0x0a && isSpaceOrTab(bytes[i + 1]);
    if (isCrlfFold) i += 2;
    else if (isLfFold) i += 1;
    else kept.push(bytes[i]);
  }
  return new TextDecoder("utf-8").decode(new Uint8Array(kept));
}

function isSpaceOrTab(byte: number | undefined): boolean {
  return byte === 0x20 || byte === 0x09;
}

/** `NAME;PARAM=value;PARAM="quoted:value":VALUE`. The value starts at the first colon outside quotes. */
function parseLine(line: string): IcsProperty {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  let valueStart = -1;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    if (!quoted && char === ":") {
      valueStart = i + 1;
      break;
    }
    if (!quoted && char === ";") {
      parts.push(part);
      part = "";
    } else {
      part += char;
    }
  }
  parts.push(part);

  const [name, ...rawParams] = parts;
  const params: Record<string, string> = {};
  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf("=");
    if (equals < 0) continue;
    const value = rawParam.slice(equals + 1);
    params[rawParam.slice(0, equals).toLowerCase()] = value.replace(/^"(.*)"$/, "$1");
  }
  return {
    name: name.toUpperCase(),
    params,
    value: valueStart < 0 ? "" : line.slice(valueStart),
  };
}
