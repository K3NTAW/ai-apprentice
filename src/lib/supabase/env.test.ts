import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appMode, clientMode, publicSupabaseEnv, supabaseEnv } from "./env";

const URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
const ANON_VAR = "NEXT_PUBLIC_SUPABASE_ANON_KEY";
const SERVICE_VAR = "SUPABASE_SERVICE_ROLE_KEY";
const ALL = [URL_VAR, ANON_VAR, SERVICE_VAR] as const;
const VALUES: Record<string, string> = {
  [URL_VAR]: "http://localhost:54321",
  [ANON_VAR]: "anon-placeholder",
  [SERVICE_VAR]: "service-placeholder",
};

let saved: NodeJS.ProcessEnv;
beforeEach(() => {
  saved = { ...process.env };
  for (const k of ALL) delete process.env[k];
});
afterEach(() => {
  process.env = saved;
});

function setEnv(nodeEnv: string, vars: readonly string[], value?: string) {
  (process.env as Record<string, string>).NODE_ENV = nodeEnv;
  for (const k of ALL) delete process.env[k];
  for (const k of vars) process.env[k] = value ?? VALUES[k];
}

function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
}

function expectedMode(nodeEnv: string, setCount: number, total: number) {
  if (setCount === total) return "supabase";
  if (setCount > 0) return "misconfigured";
  return nodeEnv === "production" ? "misconfigured" : "local";
}

const NODE_ENVS = ["development", "test", "production"];

describe("appMode", () => {
  for (const nodeEnv of NODE_ENVS) {
    for (const vars of subsets(ALL)) {
      const expected = expectedMode(nodeEnv, vars.length, 3);
      it(`${nodeEnv} with [${vars.join(", ")}] -> ${expected}`, () => {
        setEnv(nodeEnv, vars);
        expect(appMode()).toBe(expected);
      });
    }
    for (const blank of ["", "   ", "\t\n"]) {
      it(`${nodeEnv}: blank ${JSON.stringify(blank)} values count as unset`, () => {
        setEnv(nodeEnv, ALL, blank);
        expect(appMode()).toBe(expectedMode(nodeEnv, 0, 3));
        setEnv(nodeEnv, [URL_VAR, ANON_VAR]);
        process.env[SERVICE_VAR] = blank;
        expect(appMode()).toBe("misconfigured");
      });
    }
  }
});

describe("clientMode", () => {
  const PUBLIC = [URL_VAR, ANON_VAR] as const;
  for (const nodeEnv of NODE_ENVS) {
    for (const vars of subsets(PUBLIC)) {
      const expected = expectedMode(nodeEnv, vars.length, 2);
      it(`${nodeEnv} with [${vars.join(", ")}] -> ${expected}`, () => {
        setEnv(nodeEnv, vars);
        expect(clientMode()).toBe(expected);
      });
    }
    it(`${nodeEnv}: ignores the service role key`, () => {
      setEnv(nodeEnv, [SERVICE_VAR]);
      expect(clientMode()).toBe(expectedMode(nodeEnv, 0, 2));
    });
    it(`${nodeEnv}: whitespace public values count as unset`, () => {
      setEnv(nodeEnv, PUBLIC, "  ");
      expect(clientMode()).toBe(expectedMode(nodeEnv, 0, 2));
    });
  }
});

describe("publicSupabaseEnv / supabaseEnv", () => {
  it("return null when nothing is set", () => {
    setEnv("development", []);
    expect(publicSupabaseEnv()).toBeNull();
    expect(supabaseEnv()).toBeNull();
  });
  it("publicSupabaseEnv is null with only one public var", () => {
    setEnv("development", [URL_VAR]);
    expect(publicSupabaseEnv()).toBeNull();
    setEnv("development", [ANON_VAR, SERVICE_VAR]);
    expect(publicSupabaseEnv()).toBeNull();
  });
  it("supabaseEnv is null without the service role key", () => {
    setEnv("development", [URL_VAR, ANON_VAR]);
    expect(publicSupabaseEnv()).toEqual({ url: VALUES[URL_VAR], anonKey: VALUES[ANON_VAR] });
    expect(supabaseEnv()).toBeNull();
    process.env[SERVICE_VAR] = "   ";
    expect(supabaseEnv()).toBeNull();
  });
  it("return trimmed values when set", () => {
    setEnv("production", ALL);
    process.env[URL_VAR] = `  ${VALUES[URL_VAR]}  `;
    expect(supabaseEnv()).toEqual({
      url: VALUES[URL_VAR],
      anonKey: VALUES[ANON_VAR],
      serviceRoleKey: VALUES[SERVICE_VAR],
    });
  });
});
