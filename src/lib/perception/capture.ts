// Browser-only screen capture loop: getDisplayMedia -> video -> canvas -> JPEG.
import { encodeWithinLimit, FRAME_MAX_WIDTH, scaledSize } from "./frame";
import { hasChanged } from "./frameDiff";

export type CapturedFrame = { jpegBase64: string; t: number; changed: boolean };

export type CaptureOptions = {
  intervalMs?: number;
  /** Frames are downscaled to at most this width, aspect kept. */
  maxWidth?: number;
  onFrame: (f: CapturedFrame) => void;
  getT: () => number;
  onFrameChange?: () => void;
};

export type CaptureHandle = {
  stop(): void;
  pause(): void;
  resume(): void;
  stream: MediaStream;
};

const DIFF_WIDTH = 160;

export async function startScreenCapture({
  intervalMs = 1500,
  maxWidth = FRAME_MAX_WIDTH,
  onFrame,
  getT,
  onFrameChange,
}: CaptureOptions): Promise<CaptureHandle> {
  if (typeof window === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
    throw new Error("screen capture is only available in the browser");
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play();

  const full = document.createElement("canvas");
  const small = document.createElement("canvas");
  const fullCtx = full.getContext("2d");
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  let previous: Uint8ClampedArray | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const grab = () => {
    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h || !fullCtx || !smallCtx) return;
    const sh = Math.max(1, Math.round((h * DIFF_WIDTH) / w));
    small.width = DIFF_WIDTH;
    small.height = sh;
    smallCtx.drawImage(video, 0, 0, DIFF_WIDTH, sh);
    const pixels = smallCtx.getImageData(0, 0, DIFF_WIDTH, sh).data;
    const changed = previous === null || hasChanged(previous, pixels);
    previous = pixels;
    if (!changed) return;
    onFrameChange?.();
    const size = scaledSize(w, h, maxWidth);
    full.width = size.width;
    full.height = size.height;
    fullCtx.drawImage(video, 0, 0, full.width, full.height);
    const jpegBase64 = encodeWithinLimit((q) =>
      full.toDataURL("image/jpeg", q).replace(/^data:image\/jpeg;base64,/, ""),
    );
    if (jpegBase64 === null) return;
    onFrame({ jpegBase64, t: getT(), changed });
  };

  const start = () => {
    if (timer === null && !stopped) timer = setInterval(grab, intervalMs);
  };
  const halt = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  start();
  return {
    stream,
    pause: halt,
    resume: start,
    stop() {
      stopped = true;
      halt();
      for (const track of stream.getTracks()) track.stop();
      video.srcObject = null;
    },
  };
}
