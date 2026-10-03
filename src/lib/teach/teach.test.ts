import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { WorkMapSchema } from "@/lib/types";
import { SAMPLE_WORKMAP } from "./sampleWorkMap";

describe("SAMPLE_WORKMAP", () => {
  it("is the email-flow map on real apps: parses, has a capex limit guardrail with the expert's quote", () => {
    const wm = WorkMapSchema.parse(SAMPLE_WORKMAP);
    expect(wm.expert).toBe("Sabine");
    expect(wm.steps.flatMap((s) => s.guardrails).map((g) => g.quote)).toContain("Equipment over €5,000 is always capex, so it gets code 0400.");
    expect(JSON.stringify(wm)).not.toMatch(/invoice|\bERP\b/i);
  });
});

describe("sandbox Teach code is gone", () => {
  const root = join(process.cwd(), "src");
  const self = relative(root, __filename);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);

  it("no file under src/ references the sandbox save hook or the ERP halo", () => {
    const needles = ["guardrail" + "Check", "checkPending" + "Action", "Pending" + "Action", "save" + "Hook", "Save" + "Hook", "Erp" + "Halo", "erp" + "Halo", "ERP" + "Halo"];
    const hits = files
      .filter((f) => relative(root, f) !== self)
      .filter((f) => needles.some((n) => readFileSync(f, "utf8").includes(n)))
      .map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});
