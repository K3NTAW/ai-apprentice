# Model retirement check

Source: platform.claude.com/docs/en/about-claude/model-deprecations. Anthropic gives at least 60 days notice before a retirement.

## Status (checked 2026-10-06)

| Model | Used for | Status | Retirement |
| --- | --- | --- | --- |
| claude-haiku-4-5-20251001 | vision, decide (default) | Active, no deprecation notice | not sooner than 2026-10-15 (tentative) |
| claude-sonnet-5-5 | fallback for all kinds | Active | not sooner than 2027-09-28 |
| claude-opus-5-5 | Work Map (default) | Active | not sooner than 2027-09-22 |

Nothing retires inside Phase 0.

## Where the ids live

`src/lib/models.ts` is the one place: `VISION_MODEL_DEFAULT`, `DECIDE_MODEL_DEFAULT`, `WORKMAP_MODEL_DEFAULT`, `FALLBACK_MODEL`, `RETIRED_MODELS` and `resolveModel(kind)`.

Env overrides (empty means default):

- `VISION_MODEL` (src/lib/perception/vision.ts)
- `DECIDE_MODEL` (src/lib/decide/llm.ts)
- `WORKMAP_MODEL` (src/lib/workmap/synthesize.ts)

## Fallback

- A model id in `RETIRED_MODELS` resolves to `FALLBACK_MODEL` (claude-sonnet-5-5) before any call, with a warn line.
- Vision and decide: when the API answers 404 with error type `not_found_error`, the call is retried once with `FALLBACK_MODEL` and a warn line is logged. A second failure is returned as is, never retried again. No retry when the model already is `FALLBACK_MODEL`.

## Switching in Vercel

1. Vercel project, Settings, Environment Variables.
2. Set `VISION_MODEL`, `DECIDE_MODEL` or `WORKMAP_MODEL` to the new id for Production (and Preview if wanted).
3. Redeploy the latest deployment so the functions pick up the new value.
4. To make it permanent, change the default in `src/lib/models.ts` and add the retired id to `RETIRED_MODELS`.

## When to re-check

- Monthly (next: 2026-11-06), and update the table date.
- On any Anthropic deprecation email, the same day.
