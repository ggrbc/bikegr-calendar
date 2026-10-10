import { describe, expect, it } from "vitest";
import { firstProperty, parseIcsEvents, textListValue, textValue } from "./ics";

const CRLF = "\r\n";
const calendar = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR", ""].join(CRLF);

describe("ICS parser", () => {
  it("unfolds continuation lines", () => {
    const ics = calendar("BEGIN:VEVENT", "SUMMARY:Wednesday Eve", " ning Rides", "END:VEVENT");
    const [event] = parseIcsEvents(ics);
    expect(firstProperty(event, "SUMMARY")?.value).toBe("Wednesday Evening Rides");
  });

  it("unfolds lines that use a tab or a bare LF", () => {
    const ics = "BEGIN:VEVENT\nSUMMARY:Dawn\n\t Patrol\nEND:VEVENT\n";
    const [event] = parseIcsEvents(ics);
    expect(firstProperty(event, "SUMMARY")?.value).toBe("Dawn Patrol");
  });

  it("joins a fold that splits a multi-byte character", () => {
    // "’" is three bytes in UTF-8 (E2 80 99). The fold falls between its first and second byte.
    const head = new TextEncoder().encode("BEGIN:VEVENT\r\nSUMMARY:Alex");
    const tail = new TextEncoder().encode("s Lemonade\r\nEND:VEVENT\r\n");
    const bytes = new Uint8Array([...head, 0xe2, 0x0d, 0x0a, 0x20, 0x80, 0x99, ...tail]);
    const [event] = parseIcsEvents(bytes);
    expect(firstProperty(event, "SUMMARY")?.value).toBe("Alex’s Lemonade");
  });

  it("unescapes \\n, \\N, \\, \\; and \\\\ in text values", () => {
    expect(textValue("Line one\\nLine two\\NLine three")).toBe("Line one\nLine two\nLine three");
    expect(textValue("Riverside Park\\,Grand Rapids\\, MI")).toBe("Riverside Park,Grand Rapids, MI");
    expect(textValue("a\\;b\\\\n")).toBe("a;b\\n");
  });

  it("splits a text list at commas that are not escaped", () => {
    expect(textListValue("Group-Ride,Non-Drop")).toEqual(["Group-Ride", "Non-Drop"]);
    expect(textListValue("Kids\\, Family,Race")).toEqual(["Kids, Family", "Race"]);
  });

  it("splits a text list after an escaped backslash", () => {
    // Raw "A\\,B": an escaped backslash, then a real comma.
    expect(textListValue("A\\\\,B")).toEqual(["A\\", "B"]);
  });

  it("reads parameters, including quoted values that contain a colon", () => {
    const ics = calendar(
      "BEGIN:VEVENT",
      'X-TKF-PROMOTION-BUTTON;label="Ride: Details";skip_details=false:https://example.org/a',
      "END:VEVENT",
    );
    const property = firstProperty(parseIcsEvents(ics)[0], "X-TKF-PROMOTION-BUTTON");
    expect(property?.params).toEqual({ label: "Ride: Details", skip_details: "false" });
    expect(property?.value).toBe("https://example.org/a");
  });

  it("splits the value at the first colon outside quotes, so URL values keep their colons", () => {
    const ics = calendar(
      "BEGIN:VEVENT",
      "X-TKF-PROMOTION-BUTTON;label=Learn More!;skip_details=false:https://x.org:8443/p?q=a:b",
      "END:VEVENT",
    );
    const property = firstProperty(parseIcsEvents(ics)[0], "X-TKF-PROMOTION-BUTTON");
    expect(property?.params.label).toBe("Learn More!");
    expect(property?.value).toBe("https://x.org:8443/p?q=a:b");
  });

  it("reads property names case-insensitively", () => {
    const ics = calendar("BEGIN:VEVENT", "dtStart;value=DATE:20260912", "END:VEVENT");
    const property = firstProperty(parseIcsEvents(ics)[0], "DTSTART");
    expect(property).toEqual({ name: "DTSTART", params: { value: "DATE" }, value: "20260912" });
  });

  it("reads only VEVENT components, and skips components inside them", () => {
    const ics = calendar(
      "X-WR-CALNAME:Bike GR Community Calendar",
      "BEGIN:VTIMEZONE",
      "TZID:America/Detroit",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:one",
      "BEGIN:VALARM",
      "UID:alarm",
      "END:VALARM",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:two",
      "END:VEVENT",
    );
    const events = parseIcsEvents(ics);
    expect(events.map((event) => event.properties.map((p) => p.value))).toEqual([["one"], ["two"]]);
  });
});
