import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fakeDesktop } from "@/lib/companion/fakeDesktop.testkit";
import { startScreenCapture, surfaceOf } from "./capture";

describe("startScreenCapture: capture scope", () => {
  let d: ReturnType<typeof fakeDesktop>;
  beforeEach(() => {
    d = fakeDesktop();
    d.install();
  });
  afterEach(() => d.uninstall());

  const start = () => startScreenCapture({ getT: () => 0, onFrame: () => {} });

  it("asks for a window first, excludes this tab and allows switching", async () => {
    const h = await start();
    expect(d.getDisplayMediaCalls[0]).toEqual({
      video: { displaySurface: "window" },
      audio: false,
      selfBrowserSurface: "exclude",
      surfaceSwitching: "include",
    });
    h.stop();
  });

  it("reports the surface from the track settings, unknown when the track gives none", async () => {
    for (const [given, want] of [
      ["monitor", "monitor"],
      ["window", "window"],
      ["browser", "browser"],
      ["application", "unknown"],
      [undefined, "unknown"],
    ] as const) {
      d.surface(given);
      const h = await start();
      expect(h.surface).toBe(want);
      expect(h.displaySurface).toBe(given);
      h.stop();
    }
  });

  it("surfaceOf maps unrecognised values to unknown", () => {
    expect(surfaceOf("monitor")).toBe("monitor");
    expect(surfaceOf("window")).toBe("window");
    expect(surfaceOf("browser")).toBe("browser");
    expect(surfaceOf(undefined)).toBe("unknown");
    expect(surfaceOf("")).toBe("unknown");
    expect(surfaceOf(1)).toBe("unknown");
  });
});
