import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const doc = fs.readFileSync(path.resolve(process.cwd(), "docs/checks/capture-scope.md"), "utf8");

describe("capture scope check doc", () => {
  it("has the Capture surface section and the six ## headings in order", () => {
    const headings = doc.split("\n").filter((l) => l.startsWith("## "));
    expect(headings).toContain("## Capture surface");
    const order = [
      "## Storage rule",
      "## Fail direction",
      "## Log line vision.frame",
      "## Steps without a frame",
      "## STORE_ALL_FRAMES",
      "## Manual check",
    ].map((h) => headings.indexOf(h));
    for (const i of order) expect(i).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeGreaterThan(order[i - 1]);
  });

  it("contains the required phrases", () => {
    for (const s of ["best effort", "updated separately", "STORE_ALL_FRAMES=1", "vision.frame"]) {
      expect(doc).toContain(s);
    }
  });
});
