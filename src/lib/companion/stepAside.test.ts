import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startScreenCapture, type CaptureHandle } from "@/lib/perception/capture";
import { fakeDesktop } from "./fakeDesktop.testkit";
import { createShareFlow, mapsRects } from "./stepAside";
import { selectTransport } from "./transport";

describe("mapsRects: rect mapping only for a shared monitor", () => {
  it("undefined and window do not map, monitor maps", () => {
    expect(mapsRects(undefined)).toBe(false);
    expect(mapsRects("window")).toBe(false);
    expect(mapsRects("monitor")).toBe(true);
    expect(mapsRects("browser")).toBe(false);
    expect(mapsRects("unknown")).toBe(false);
  });

  describe("through a share in the desktop app", () => {
    let d: ReturnType<typeof fakeDesktop>;
    beforeEach(() => {
      d = fakeDesktop();
      d.install();
    });
    afterEach(() => d.uninstall());

    for (const [given, want] of [
      [undefined, false],
      ["window", false],
      ["monitor", true],
    ] as const) {
      it(`track surface ${String(given)}: maps rects ${want}`, async () => {
        const transport = selectTransport({ storage: null, env: undefined });
        transport.connect();
        d.paired();
        d.surface(given);
        const flow = createShareFlow<CaptureHandle>(() => transport);
        const h = await flow.start((onEnded) => startScreenCapture({ getT: () => 0, onFrame: () => {}, onEnded }));
        expect(mapsRects(h?.surface)).toBe(want);
        flow.stop();
        transport.dispose();
      });
    }
  });
});
