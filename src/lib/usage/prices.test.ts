// Every model id src/lib/models.ts can send (defaults and fallback) has a model_prices seed row.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import * as models from "@/lib/models";
import { DECIDE_MODEL_DEFAULT, FALLBACK_MODEL, VISION_MODEL_DEFAULT, WORKMAP_MODEL_DEFAULT } from "@/lib/models";

const sql = readFileSync(path.join(process.cwd(), "supabase/migrations/20261006000000_usage_events.sql"), "utf8").replace(
  /--[^\n]*/g,
  "",
);
const insert = sql
  .split(";")
  .map((s) => s.trim())
  .find((s) => s.startsWith("insert into public.model_prices"));

const seeded = new Set([...(insert ?? "").matchAll(/\(\s*'([^']+)'\s*,\s*'\d{4}-\d{2}-\d{2}'/g)].map((m) => m[1]));

describe("model_prices seed", () => {
  it("has an insert", () => {
    expect(insert).toBeDefined();
    expect(seeded.size).toBeGreaterThan(0);
  });

  it.each([VISION_MODEL_DEFAULT, DECIDE_MODEL_DEFAULT, WORKMAP_MODEL_DEFAULT, FALLBACK_MODEL])("prices %s", (id) => {
    expect(seeded.has(id)).toBe(true);
  });

  it("prices every string model id exported by src/lib/models.ts", () => {
    const ids = (Object.values(models) as unknown[]).filter((v): v is string => typeof v === "string");
    expect(ids.length).toBeGreaterThanOrEqual(4);
    expect(ids.filter((id) => !seeded.has(id))).toEqual([]);
  });
});
