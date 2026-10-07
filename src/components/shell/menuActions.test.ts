// switchWorkspace (T-0353): the page reloads only after the POST /api/workspace/active response is in and ok, so the
// reload request always carries the new ws cookie. A !ok response or a network error never reloads.
import { describe, expect, it } from "vitest";
import { switchWorkspace, type MenuDeps } from "./menuActions";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

type Res = { ok: boolean; status: number; json(): Promise<unknown> };

/** Deps that record every step in order; the fetch settles one macrotask later, like a network response. */
function deps(outcome: { ok: boolean; status: number } | "throw") {
  const log: string[] = [];
  const d: MenuDeps = {
    fetch: (url, init) => {
      log.push(`fetch ${init.method} ${url} ${String(init.body)}`);
      return new Promise<Res>((resolve, reject) =>
        setTimeout(() => {
          log.push("fetch settled");
          if (outcome === "throw") reject(new TypeError("Failed to fetch"));
          else resolve({ ...outcome, json: async () => ({}) });
        }, 0),
      );
    },
    reload: () => log.push("reload"),
  };
  return { d, log };
}

describe("switchWorkspace", () => {
  it("reloads once, after the ok POST has resolved", async () => {
    const { d, log } = deps({ ok: true, status: 200 });
    const pending = switchWorkspace(WS_B, WS_A, d);
    expect(log).toEqual([`fetch POST /api/workspace/active {"workspaceId":"${WS_B}"}`]);
    expect(await pending).toEqual({ ok: true });
    expect(log).toEqual([`fetch POST /api/workspace/active {"workspaceId":"${WS_B}"}`, "fetch settled", "reload"]);
  });

  for (const status of [400, 401, 403, 500]) {
    it(`a ${status} response never reloads and returns ok:false`, async () => {
      const { d, log } = deps({ ok: false, status });
      expect(await switchWorkspace(WS_B, WS_A, d)).toEqual({ ok: false });
      expect(log).not.toContain("reload");
    });
  }

  it("a thrown fetch never reloads and returns ok:false", async () => {
    const { d, log } = deps("throw");
    expect(await switchWorkspace(WS_B, WS_A, d)).toEqual({ ok: false });
    expect(log).toEqual([`fetch POST /api/workspace/active {"workspaceId":"${WS_B}"}`, "fetch settled"]);
  });

  it("the active workspace is a no-op: no POST, no reload", async () => {
    const { d, log } = deps({ ok: true, status: 200 });
    expect(await switchWorkspace(WS_A, WS_A, d)).toEqual({ ok: true });
    expect(log).toEqual([]);
  });
});
