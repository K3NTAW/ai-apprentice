// Browser fetch adapter for the capture controller: /api/session/<id>/*, /api/decide, /api/vision.
import type { ScreenEvent } from "@/lib/types";
import type { CaptureApi, Decisions } from "./controller";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export function createHttpCaptureApi(sessionId: string, previousEvents: () => ScreenEvent[]): CaptureApi {
  const base = `/api/session/${encodeURIComponent(sessionId)}`;
  return {
    postEvents: (events) => post(`${base}/events`, { events }),
    postTranscript: (entries) => post(`${base}/transcript`, { entries }),
    postQA: (qa) => post(`${base}/qa`, { qa }),
    setOffRecord: (range) => post(`${base}/off-record`, range),
    decide: async (questions, state) =>
      (await post<{ results: Partial<Decisions> }>("/api/decide", { questions, state })).results,
    postFrame: (frame) =>
      post("/api/vision", {
        session_id: sessionId,
        t: frame.t,
        frame: frame.jpegBase64,
        previous: previousEvents().slice(-8),
      }),
  };
}

export async function createCaptureSession(expert: string): Promise<string> {
  const s = await post<{ id: string }>("/api/session", { kind: "capture", expert });
  return s.id;
}
