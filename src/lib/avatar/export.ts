// Export helpers for the avatar studio: SVG as-is, PNG rendered through a canvas (512 px by default).
import { toDataUrl } from "./render";

export const SVG_MIME = "image/svg+xml";
export const PNG_MIME = "image/png";
export const PNG_EXPORT_SIZE = 512;

export function svgBlob(svg: string): Blob {
  return new Blob([svg], { type: SVG_MIME });
}

type Canvas2D = { drawImage(img: unknown, x: number, y: number, w: number, h: number): void; clearRect(x: number, y: number, w: number, h: number): void };
export type CanvasLike = {
  width: number;
  height: number;
  getContext(kind: "2d"): Canvas2D | null;
  toBlob(cb: (blob: Blob | null) => void, type: string): void;
};

export type PngDeps = {
  createCanvas: () => CanvasLike;
  loadImage: (src: string) => Promise<unknown>;
};

const browserDeps = (): PngDeps => ({
  createCanvas: () => document.createElement("canvas") as unknown as CanvasLike,
  loadImage: (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("avatar image failed to load"));
      img.src = src;
    }),
});

export async function pngBlob(svg: string, size = PNG_EXPORT_SIZE, deps: PngDeps = browserDeps()): Promise<Blob> {
  const img = await deps.loadImage(toDataUrl(svg));
  const canvas = deps.createCanvas();
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas 2d context unavailable");
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(img, 0, 0, size, size);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, PNG_MIME));
  if (!blob) throw new Error("PNG export failed");
  return blob.type === PNG_MIME ? blob : new Blob([blob], { type: PNG_MIME });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function exportFilename(name: string, ext: "svg" | "png"): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "avatar";
  return `${slug}.${ext}`;
}
