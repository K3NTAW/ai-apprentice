// Guard for the live suite (e2e/live): nothing records typed input and nothing prints the test user's credentials.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "./live/playwright.live.config";

const dir = fileURLToPath(new URL("./live", import.meta.url));
const files = fs
  .readdirSync(dir)
  .filter((f) => f.endsWith(".ts"))
  .map((f) => ({ name: f, text: fs.readFileSync(path.join(dir, f), "utf8") }));
const specs = files.filter((f) => f.name.endsWith(".spec.ts"));

const SINK = /console\.\w+\(|process\.(stdout|stderr)\.write|\.attach\(|annotations\.push|appGap\(|writeFileSync\(|\bshot\(/;
const CREDENTIAL = /E2E_PASSWORD|E2E_EMAIL|creds\(\)|\bpassword\b|\bemail\b/;

describe("e2e:live guard", () => {
  it("has trace, video and Playwright screenshots off", () => {
    expect(config.use?.trace).toBe("off");
    expect(config.use?.video).toBe("off");
    expect(config.use?.screenshot).toBe("off");
    for (const p of config.projects ?? []) {
      expect(p.use?.trace ?? "off").toBe("off");
      expect(p.use?.video ?? "off").toBe("off");
    }
  });

  it("has spec files", () => {
    expect(specs.length).toBeGreaterThan(0);
  });

  it("reads the credentials only in env.ts", () => {
    for (const f of files.filter((x) => x.name !== "env.ts")) {
      expect(f.text, f.name).not.toMatch(/process\.env\.(E2E_PASSWORD|E2E_EMAIL)|process\.env\[["'](E2E_PASSWORD|E2E_EMAIL)/);
    }
  });

  it("never logs, attaches or writes the credentials", () => {
    for (const f of files) {
      const hits = f.text.split("\n").filter((l) => SINK.test(l) && CREDENTIAL.test(l));
      expect(hits, f.name).toEqual([]);
    }
  });

  it("masks the password field in every screenshot", () => {
    const calls = files.flatMap((f) => [...f.text.matchAll(/\.screenshot\((\{[^}]*\})/g)].map((m) => m[1]));
    expect(calls.length).toBeGreaterThan(0);
    for (const args of calls) expect(args).toMatch(/\bmask\b/);
    expect(files.find((f) => f.name === "fixtures.ts")?.text).toMatch(/input\[type=password\]/);
  });
});
