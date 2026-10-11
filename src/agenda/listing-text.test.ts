import { describe, expect, it } from "vitest";
import { listingText } from "./listing-text";

describe("listingText", () => {
  it("is the Custom Preview when set", () => {
    expect(listingText({ preview: "Easy pace.", description: "# Long\n\nText" }, 300)).toBe("Easy pace.");
  });

  it("else the description as plain text, cut to the length", () => {
    expect(listingText({ preview: null, description: "# Route\n\n**Bold** [Map](https://m.org)" }, 300)).toBe(
      "Route Bold Map (https://m.org)",
    );
    expect(listingText({ preview: null, description: "x".repeat(400) }, 160)).toHaveLength(160);
  });

  it("flattens a preview's line breaks and cuts it to a shorter length", () => {
    expect(listingText({ preview: "One\nTwo", description: "" }, 300)).toBe("One Two");
    expect(listingText({ preview: "y".repeat(300), description: "" }, 160)).toHaveLength(160);
  });
});
