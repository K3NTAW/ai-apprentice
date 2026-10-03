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

describe("shortcut hint on the slow path (agents wave A5)", async () => {
  const { createShortcutCoach, SHORTCUT_QUIET_MS } = await import("./shortcutHint");
  const base = WorkMapSchema.parse(SAMPLE_WORKMAP);
  const step = base.steps[0];
  const workmap = {
    ...base,
    shortcuts: [{ chord: "Cmd+Enter", app: "Microsoft Outlook", effect: "email out", effect_type: "item_sent" as const, first_t: 1, count: 3, step: step.n }],
  };
  const done = { id: "e1", t: 5, source: "vision" as const, type: "item_sent" as const, entity: { kind: "email", id: "Offer" } };

  it("the slow path on a step with a shortcut triggers one suggestion naming the expert and the chord", () => {
    const coach = createShortcutCoach({ workmap, now: () => 0 });
    expect(coach.onEvent(done, step)?.text).toBe("Sabine uses Cmd+Enter here.");
    expect(coach.onEvent({ ...done, id: "e2" }, step)).toBeNull();
  });

  it("no hint when the learner pressed the chord, on another step, for another effect, or while busy", () => {
    let t = 0;
    const coach = createShortcutCoach({ workmap, now: () => t });
    coach.noteChord("Cmd+Enter");
    t = SHORTCUT_QUIET_MS - 1;
    expect(coach.onEvent(done, step)).toBeNull();
    t = SHORTCUT_QUIET_MS + 1;
    expect(coach.onEvent(done, { ...step, n: step.n + 99 })).toBeNull();
    expect(coach.onEvent({ ...done, type: "item_deleted" }, step)).toBeNull();
    expect(coach.onEvent(done, step, { busy: true })).toBeNull();
    expect(coach.onEvent(done, step)?.text).toBe("Sabine uses Cmd+Enter here.");
  });
});
