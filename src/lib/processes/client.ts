// Browser calls of the process page and the Processes tab (/api/processes). fetchFn is injectable for tests.
// Errors carry a sentence for the page: 503 (migration missing), 409 (changed meanwhile), 403 (role).
import type { Process, ProcessVersion } from "@/lib/store/types";
import type { WorkMap } from "@/lib/types";

type Fetch = typeof fetch;

function message(status: number): string {
  if (status === 503) return "Processes are not available yet.";
  if (status === 409) return "The process changed meanwhile. Reload and try again.";
  if (status === 403) return "Your role cannot do this.";
  if (status === 404) return "The process was not found.";
  return `The change failed (${status}).`;
}

async function call<T>(fetchFn: Fetch, url: string, init?: RequestInit): Promise<T> {
  const res = await fetchFn(url, { cache: "no-store", ...init });
  if (!res.ok) throw new Error(message(res.status));
  return (res.status === 204 ? null : await res.json()) as T;
}

const url = (id: string) => `/api/processes/${encodeURIComponent(id)}`;
const json = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export type ProcessEdit = { title?: string; workmap?: WorkMap; archived?: boolean; expected_version?: number };

export const getProcess = (id: string, fetchFn: Fetch = fetch) => call<Process>(fetchFn, url(id));
export const listVersions = (id: string, fetchFn: Fetch = fetch) =>
  call<{ versions: ProcessVersion[] }>(fetchFn, `${url(id)}/versions`).then((r) => r.versions);
export const patchProcess = (id: string, edit: ProcessEdit, fetchFn: Fetch = fetch) => call<Process>(fetchFn, url(id), json("PATCH", edit));
export const deleteProcess = (id: string, fetchFn: Fetch = fetch) => call<null>(fetchFn, url(id), { method: "DELETE" });

/** A Work Map edit: a new 'edited' version based on the version shown. */
export const saveWorkMap = (p: Pick<Process, "id" | "version">, workmap: WorkMap, fetchFn: Fetch = fetch) =>
  patchProcess(p.id, { workmap, expected_version: p.version }, fetchFn);

/** Restore: the old version's Work Map becomes a new version (the history only grows). */
export const restoreVersion = (p: Pick<Process, "id" | "version">, v: Pick<ProcessVersion, "workmap">, fetchFn: Fetch = fetch) =>
  saveWorkMap(p, v.workmap, fetchFn);
