// The forwarded-user key (T-0178): FORWARDED_USER_SECRET, else SUPABASE_SERVICE_ROLE_KEY, else one warning on the
// first request after startup and no forwarding at all (the render falls back to its own getUser).
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const fresh = async () => {
  vi.resetModules();
  return import("./forwardedUser");
};

describe("forwarded-user key", () => {
  it("neither variable set: one warning per process, nothing signs or verifies", async () => {
    vi.stubEnv("FORWARDED_USER_SECRET", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const m = await fresh();
    expect(m.signForwardedUser({ id: "u1" })).toBeNull();
    expect(m.signForwardedUser({ id: "u2" })).toBeNull();
    m.warnIfNoForwardedUserKey();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("FORWARDED_USER_SECRET");
    expect(m.verifyForwardedUser("eyJpZCI6InUxIn0.x")).toBeNull();
  });

  it("FORWARDED_USER_SECRET or the service role key alone: no warning, sign and verify round trip", async () => {
    for (const [name, other] of [
      ["FORWARDED_USER_SECRET", "SUPABASE_SERVICE_ROLE_KEY"],
      ["SUPABASE_SERVICE_ROLE_KEY", "FORWARDED_USER_SECRET"],
    ]) {
      vi.stubEnv(name, "secret-placeholder");
      vi.stubEnv(other, "");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const m = await fresh();
      expect(m.verifyForwardedUser(m.signForwardedUser({ id: "u1" }))?.id, name).toBe("u1");
      m.warnIfNoForwardedUserKey();
      expect(warn, name).not.toHaveBeenCalled();
      warn.mockRestore();
    }
  });
});
