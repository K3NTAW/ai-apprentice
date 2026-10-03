import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PNG_MIME, SVG_MIME, exportFilename, pngBlob, svgBlob } from "@/lib/avatar/export";
import { DEFAULT_AVATAR, renderAvatarSvg } from "@/lib/avatar/render";
import { httpAvatarSaver } from "@/lib/avatar/save";
import AvatarStudio from "./AvatarStudio";
import { initStudio, previewSvg, studioReducer } from "./studioModel";

describe("studio model", () => {
  it("pickers update the preview model", () => {
    let m = initStudio();
    expect(m).toEqual({ avatar: DEFAULT_AVATAR, state: "idle" });
    m = studioReducer(m, { type: "shape", shape: "star" });
    m = studioReducer(m, { type: "face", face: "robot" });
    m = studioReducer(m, { type: "color", color: "#264653" });
    m = studioReducer(m, { type: "accent", accent: "#e9c46a" });
    expect(m.avatar).toEqual({ shape: "star", face: "robot", color: "#264653", accent: "#E9C46A" });
    expect(previewSvg(m, 256)).toBe(renderAvatarSvg(m.avatar, "idle", 256));
    expect(studioReducer(m, { type: "color", color: "red" })).toBe(m);
  });

  it("play buttons switch the state and randomize changes the avatar", () => {
    let m = initStudio();
    for (const state of ["talking", "stop", "paused"] as const) {
      m = studioReducer(m, { type: "play", state });
      expect(m.state).toBe(state);
      expect(previewSvg(m)).toBe(renderAvatarSvg(m.avatar, state, 256));
    }
    const r = studioReducer(m, { type: "randomize", rand: () => 0.99 });
    expect(r.avatar).not.toEqual(m.avatar);
    expect(r.state).toBe("paused");
  });

  it("renders pickers, eight animation buttons and the preview as an <img> data URL", () => {
    const html = renderToStaticMarkup(<AvatarStudio initialAvatar={{ ...DEFAULT_AVATAR, shape: "pill" }} />);
    expect(html).toContain('src="data:image/svg+xml;base64,');
    for (const label of ["idle", "listening", "thinking", "talking", "asking", "stop", "happy", "paused", "Randomize", "Export SVG", "Export PNG"])
      expect(html).toContain(`>${label}</button>`);
    expect(html).toMatch(/aria-pressed="true"[^>]*>pill</);
    expect(html).not.toContain(">Save</button>");
    const saver = { save: vi.fn() };
    expect(renderToStaticMarkup(<AvatarStudio agentId="a1" saver={saver} />)).toContain(">Save</button>");
  });
});

describe("export helpers", () => {
  const svg = renderAvatarSvg(DEFAULT_AVATAR, "happy", 512);

  it("SVG export is image/svg+xml", async () => {
    const blob = svgBlob(svg);
    expect(blob.type).toBe(SVG_MIME);
    expect(await blob.text()).toBe(svg);
    expect(exportFilename("Senior Sales Person!", "png")).toBe("senior-sales-person.png");
  });

  it("PNG export draws at 512 px and returns image/png", async () => {
    const drawImage = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, clearRect: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void, type: string) => cb(new Blob(["png"], { type })),
    };
    const loadImage = vi.fn(async (src: string) => ({ src }));
    const blob = await pngBlob(svg, undefined, { createCanvas: () => canvas, loadImage });
    expect(blob.type).toBe(PNG_MIME);
    expect(canvas.width).toBe(512);
    expect(loadImage.mock.calls[0][0]).toMatch(/^data:image\/svg\+xml;base64,/);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 512, 512);
  });

  it("http saver PATCHes the agent avatar", async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 204 }));
    await httpAvatarSaver(fetchImpl as unknown as typeof fetch).save("abc", DEFAULT_AVATAR);
    expect(fetchImpl).toHaveBeenCalledWith("/api/agents/abc", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ avatar: DEFAULT_AVATAR }) }));
    const failing = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(httpAvatarSaver(failing as unknown as typeof fetch).save("abc", DEFAULT_AVATAR)).rejects.toThrow(/404/);
  });
});
