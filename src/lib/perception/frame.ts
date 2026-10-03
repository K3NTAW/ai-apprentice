// Frame size rules shared by the browser capture loop and POST /api/vision. Pure, no DOM.

/** Request bodies over 2 MB answer 413 (Vercel caps bodies at 4.5 MB). */
export const MAX_FRAME_BODY_BYTES = 2 * 1024 * 1024;
/** Full-screen frames are downscaled to at most this width, aspect kept. */
export const FRAME_MAX_WIDTH = 1600;
export const FRAME_QUALITY = 0.7;
/** One client-side retry at lower quality when the first encode is too big. */
export const FRAME_RETRY_QUALITY = 0.5;
/** Room left in the body for session_id, t and the recent events. */
const BODY_OVERHEAD_BYTES = 64 * 1024;
export const MAX_FRAME_BASE64_CHARS = MAX_FRAME_BODY_BYTES - BODY_OVERHEAD_BYTES;

export function scaledSize(width: number, height: number, maxWidth = FRAME_MAX_WIDTH): { width: number; height: number } {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const scale = Math.min(1, maxWidth / width);
  return { width: Math.round(width * scale), height: Math.max(1, Math.round(height * scale)) };
}

/** Encodes at FRAME_QUALITY, retries once at FRAME_RETRY_QUALITY; null when it still does not fit. */
export function encodeWithinLimit(encode: (quality: number) => string, limit = MAX_FRAME_BASE64_CHARS): string | null {
  const first = encode(FRAME_QUALITY);
  if (first.length <= limit) return first;
  const second = encode(FRAME_RETRY_QUALITY);
  return second.length <= limit ? second : null;
}
