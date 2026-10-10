import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("import and engine boundary", () => {
  it("the import uses only the engine's public API (@/engine)", () => {
    const folder = new URL("./", import.meta.url);
    const deepImports = readdirSync(folder)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        readFileSync(new URL(file, folder), "utf8")
          .split("\n")
          .filter((line) => /from\s+["'](@\/engine\/|\.\.\/engine)/.test(line))
          .map((line) => `${file}: ${line.trim()}`),
      );
    expect(deepImports).toEqual([]);
  });
});
