// Browser fetch adapter for the debrief controller: /api/workmap, /api/workmap/confirm, /api/session/<id>/*.
import type { WorkMap } from "@/lib/types";
import type { BuildResult, DebriefApi } from "./controller";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export function createHttpDebriefApi(sessionId: string): DebriefApi {
  const base = `/api/session/${encodeURIComponent(sessionId)}`;
  return {
    buildWorkMap: (id, rescoreOnly) => post<BuildResult>("/api/workmap", { session_id: id, rescore_only: rescoreOnly }),
    confirm: (id, confirmed, correction) =>
      post<{ workmap: WorkMap }>("/api/workmap/confirm", { session_id: id, confirmed, correction }),
    postTranscript: (entries) => post(`${base}/transcript`, { entries }),
    postQA: (qa) => post(`${base}/qa`, { qa }),
  };
}
