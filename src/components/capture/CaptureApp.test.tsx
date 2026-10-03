// Capture's desktop app share (fix round T-0123): the Start/End/unmount sequence CaptureApp runs, over a fake
// window.apprentice and a mocked getDisplayMedia: the real bridge transport, startScreenCapture, the share flow
// and the start order (voice agent, then getDisplayMedia, then step-aside). The repo has no DOM test renderer
// (no jsdom), so the component's start(), toggleShare(), endTask() and unmount cleanup are driven through the
// same functions they call.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startScreenCapture, type CaptureHandle } from "@/lib/perception/capture";
import { flush, fakeDesktop } from "@/lib/companion/fakeDesktop.testkit";
import { createShareFlow, startVoiceThenShare } from "@/lib/companion/stepAside";
import { selectTransport, type CompanionTransport } from "@/lib/companion/transport";

type Desktop = ReturnType<typeof fakeDesktop>;

function captureApp(d: Desktop, { voiceFails = false } = {}) {
  const transport: CompanionTransport = selectTransport({ storage: null, env: undefined });
  transport.connect();
  const share = createShareFlow<CaptureHandle>(() => transport);
  const state = { sharing: false, textMode: false, notice: null as string | null };

  const toggleShare = async (stepAside = true) => {
    const clear = () => {
      state.sharing = false;
    };
    if (share.handle()) {
      share.stop();
      clear();
      return;
    }
    try {
      const handle = await share.start(
        (onEnded) => startScreenCapture({ getT: () => 0, onFrame: () => {}, onEnded }),
        { stepAside, onEnded: clear },
      );
      if (!handle) return;
      state.sharing = true;
    } catch (err) {
      state.notice = `Screen share not started (${err instanceof Error ? err.message : String(err)}).`;
    }
  };

  return {
    transport,
    state,
    share,
    start: () =>
      startVoiceThenShare({
        startVoice: async () => {
          d.log.push("agent.start");
          if (voiceFails) {
            state.textMode = true;
            state.notice = "Voice did not start (microphone blocked).";
            return false;
          }
          return true;
        },
        inApp: transport.kind === "bridge",
        share: (stepAside) => toggleShare(stepAside),
      }),
    end: () => {
      share.stop();
      state.sharing = false;
    },
    unmount: () => {
      share.stop();
      transport.dispose();
    },
  };
}

describe("CaptureApp in the desktop app: step aside and restore", () => {
  let d: Desktop;
  beforeEach(() => {
    d = fakeDesktop();
    d.install();
  });
  afterEach(() => d.uninstall());

  it("Start: the voice agent first, then getDisplayMedia (monitor), then step-aside; End restores", async () => {
    const app = captureApp(d);
    expect(app.transport.kind).toBe("bridge");
    d.paired();
    await app.start();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:step-aside"]);
    expect(d.getDisplayMediaCalls[0]).toMatchObject({ video: { displaySurface: "monitor" } });
    expect(app.state.sharing).toBe(true);
    app.end();
    expect(d.log.at(-1)).toBe("window:restore");
    expect(d.track.stopped).toBe(1);
    app.end();
    expect(d.log.filter((l) => l === "window:restore")).toHaveLength(1);
  });

  it("voice start failure: no step-aside, the error shows, the share still runs in front", async () => {
    const app = captureApp(d, { voiceFails: true });
    d.paired();
    await app.start();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia"]);
    expect(app.state.notice).toContain("Voice did not start");
    app.end();
    expect(d.log).not.toContain("window:restore");
  });

  it("an error during start (the video does not play) restores and shows the error", async () => {
    const app = captureApp(d);
    d.paired();
    d.failVideo();
    await app.start();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:restore"]);
    expect(app.state.notice).toContain("video failed");
    expect(app.state.sharing).toBe(false);
  });

  it("the captured stream ends by itself: restore", async () => {
    const app = captureApp(d);
    d.paired();
    await app.start();
    d.endStream();
    expect(d.log.at(-1)).toBe("window:restore");
    expect(app.state.sharing).toBe(false);
    expect(app.share.handle()).toBeNull();
  });

  it("getDisplayMedia rejected: never steps aside, restores once, shows the error", async () => {
    const app = captureApp(d);
    d.paired();
    d.nextShare("reject");
    await app.start();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:restore"]);
    expect(app.state.notice).toContain("Permission denied");
  });

  it("unmount while stepped aside restores", async () => {
    const app = captureApp(d);
    d.paired();
    await app.start();
    app.unmount();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:step-aside", "window:restore"]);
    expect(d.track.stopped).toBe(1);
  });

  it("End while getDisplayMedia is pending: no later step-aside, the late stream is stopped", async () => {
    const app = captureApp(d);
    d.paired();
    d.nextShare("hold");
    const started = app.start();
    await flush();
    app.end();
    d.release();
    await started;
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:restore"]);
    expect(d.track.stopped).toBe(1);
  });

  it("the window steps aside even before the app's first status event (the preload owns the window)", async () => {
    const app = captureApp(d);
    expect(app.transport.status().status).toBe("connecting");
    await app.start();
    expect(d.log).toEqual(["agent.start", "getDisplayMedia", "window:step-aside"]);
    app.unmount();
  });
});
