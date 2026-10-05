// One place for model ids, their env overrides and the retirement fallback. See docs/checks/models.md.
export const VISION_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const DECIDE_MODEL_DEFAULT = "claude-haiku-4-5-20251001";
export const WORKMAP_MODEL_DEFAULT = "claude-opus-5-5";
export const FALLBACK_MODEL = "claude-sonnet-5-5";

/** Model ids known to be retired: a request for one goes straight to FALLBACK_MODEL. */
export const RETIRED_MODELS: readonly string[] = [];

export type ModelKind = "vision" | "decide" | "workmap";

const ENV: Record<ModelKind, { env: string; fallback: string }> = {
  vision: { env: "VISION_MODEL", fallback: VISION_MODEL_DEFAULT },
  decide: { env: "DECIDE_MODEL", fallback: DECIDE_MODEL_DEFAULT },
  workmap: { env: "WORKMAP_MODEL", fallback: WORKMAP_MODEL_DEFAULT },
};

/** The env override when set, else the default; a retired id resolves to FALLBACK_MODEL. */
export function resolveModel(kind: ModelKind): string {
  const { env, fallback } = ENV[kind];
  const model = process.env[env]?.trim() || fallback;
  if (RETIRED_MODELS.includes(model)) {
    console.warn(`models: ${model} is retired, using ${FALLBACK_MODEL}`);
    return FALLBACK_MODEL;
  }
  return model;
}

/** True when the API answered 404 with error type not_found_error (unknown or retired model). */
export async function isModelNotFound(res: Response): Promise<boolean> {
  if (res.status !== 404) return false;
  try {
    const body = (await res.clone().json()) as { error?: { type?: string } };
    return body?.error?.type === "not_found_error";
  } catch {
    return false;
  }
}

/**
 * Sends with the resolved model; on a model not_found_error retries once with FALLBACK_MODEL and returns
 * that second response as is (never retried again). No retry when the model already is FALLBACK_MODEL.
 */
export async function sendWithModelFallback(kind: ModelKind, send: (model: string) => Promise<Response>): Promise<Response> {
  const model = resolveModel(kind);
  const res = await send(model);
  if (model === FALLBACK_MODEL || !(await isModelNotFound(res))) return res;
  console.warn(`models: ${model} not found (${kind}), retrying once with ${FALLBACK_MODEL}`);
  return send(FALLBACK_MODEL);
}
