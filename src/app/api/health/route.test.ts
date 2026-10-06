import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const requireContext = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/context", () => ({ requireContext }));

import { GET, runtime } from "./route";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/health", () => {
  it("answers 200 {ok: true}, no-store, without a context, and writes one request line", async () => {
    const lines: unknown[] = [];
    for (const m of ["log", "warn", "error"] as const) {
      vi.spyOn(console, m).mockImplementation((t: unknown) => {
        lines.push(JSON.parse(String(t)));
      });
    }
    const res = await GET(new Request("http://localhost/api/health"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(requireContext).not.toHaveBeenCalled();
    const requests = lines.filter((l) => (l as { event?: string }).event === "request");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ route: "/api/health", method: "GET", status: 200 });
  });

  it("exports runtime nodejs and imports neither auth nor store", async () => {
    expect(runtime).toBe("nodejs");
    const src = await readFile(fileURLToPath(new URL("./route.ts", import.meta.url)), "utf8");
    expect(src).not.toMatch(/requireContext|@\/lib\/auth|@\/lib\/store/);
  });
});
