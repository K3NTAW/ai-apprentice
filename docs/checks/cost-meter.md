# Cost meter (parts 1 and 2 of 3: schema, prices, recorder, model callers, cost route, CostCard)

Migration `supabase/migrations/20261006000000_usage_events.sql`, rollback `supabase/rollbacks/20261006000000_usage_events.down.sql`, recorder `src/lib/usage/events.ts`.

`usage_counters` (daily caps) counts calls. `usage_events` records tokens, voice seconds and frame bytes per call, and `usage_cost_daily` prices them in CHF. Part 1 added the schema and recorder, part 2 wires vision, decide and workmap plus the cost route and CostCard, part 3 wires voice.

## Model callers (part 2, wired)

One usage event per answered model call. The model is read from the Anthropic response JSON (`model`), never from `resolveModel`, so a fallback after a 404 (`sendWithModelFallback`) is recorded as the fallback. Tokens come from `usage.input_tokens`, `usage.output_tokens` and `usage.cache_read_input_tokens` (0 when absent). A response without a `usage` block records nothing.

| kind | caller | when |
| --- | --- | --- |
| `vision` | `POST /api/vision` via `describeFrame` (`src/lib/perception/vision.ts`) | right after the model answered, before any off-record, skipped or error return |
| `frame` | `POST /api/vision` | only after `saveFrame` succeeded; `bytes` is the decoded JPEG size |
| `decide` | `POST /api/decide` via `decideMany({ onUsage })` (`src/lib/decide/llm.ts`) | only when the LLM answered, never on the jev or heuristic paths |
| `workmap` | `POST /api/workmap` via `rebuildWorkMap({ onUsage })` (`src/lib/workmap/synthesize.ts`) | once per successful response; a rebuild that lost the race to its budget records nothing |

`onUsage` callbacks are wrapped in try/catch inside the library: a throwing callback never changes a model-call outcome. `src/lib/usage/callers.test.ts` fails when a non-test file under `src/` calls `api.anthropic.com` and is not one of the three metered files.

## Cost route

`GET /api/workspace/cost?days=N`, any member role:

- `days` is an integer 1..90, default 30; anything else answers 400 `{ "error": "invalid days" }`.
- The cut-off is today's Europe/Zurich date minus `days - 1`, the same bucket as the view's `day`.
- Reads `usage_cost_daily` through the user client (never the service role), `.eq("workspace_id", <active workspace>)`, `.gte("day", cutoff)`, newest day first, `.limit(500)`. Rows of another workspace that still come back are dropped.
- At most 500 rows: when 500 come back the answer has `truncated: true` and the card says "showing the latest 500 rows".
- Rows are untrusted: numeric strings go through `Number()` (NaN -> null), `chf` null stays null, `unpriced_events` defaults to 0, unknown kinds become `other`, a `day` that is not `YYYY-MM-DD` drops the row.
- Answer: `{ days, truncated, rows: [{ day, kind, events, input_tokens, output_tokens, cache_read_tokens, voice_seconds, bytes, chf, unpriced_events }] }`. Local mode: `{ days, truncated: false, rows: [], local: true }`.

`CostCard` (`src/components/workspace/CostCard.tsx`) on `/workspace` (supabase mode only) shows one line per day: CHF (sum of priced rows), tokens, voice minutes, frame MB, and each kind with its CHF or "not priced". Any `unpriced_events > 0` labels the total "partial".

## Query one day's cost per workspace

As a signed-in member (the view is `security_invoker`, so RLS on `usage_events` applies and you see only your workspaces):

```sql
select workspace_id, kind, events, input_tokens, output_tokens, cache_read_tokens,
       voice_seconds, bytes, chf, unpriced_events
from public.usage_cost_daily
where day = '2026-10-06'
order by workspace_id, kind;

-- total per workspace
select workspace_id, sum(chf) as chf, sum(unpriced_events) as unpriced_events
from public.usage_cost_daily
where day = '2026-10-06'
group by workspace_id;
```

`day` is the Europe/Zurich date of `created_at`. `unpriced_events > 0` means a vision, decide, workmap or voice row had no price row valid on that day (new model id, or a `valid_from` after the day): add a `model_prices` / `voice_prices` row in a new migration.

## Deploy order

1. Apply the migration (`supabase db push`).
2. Then deploy parts 2 and 3.

Part 1 alone is safe in any order. Part 2 without the migration is safe too: the recorder backs off on the missing table and the cost route answers 500 until the view exists.

## Kill switch

`USAGE_EVENTS=0` turns recording off (no insert, no `after()` scheduled). Local mode never records.

## Missing table backoff

If the table is missing (Postgres 42P01 or PostgREST PGRST205), the recorder logs one `usage.events` warn with reason `table_missing` and skips inserts for 5 minutes, then tries again. Applying the migration needs no restart.

## Failure behaviour

`recordUsage` returns at once and inserts after the response through `after()` from `next/server`, with the service role client. Each insert is aborted after 5000 ms. A failed, rejected or aborted insert, or a call outside a request scope (`no_request_scope`), logs exactly one `usage.events` warn and is dropped. It never throws to the caller. `insertUsageEvent` is the awaited variant for part 3 and maps 23505 to `{ ok: false, reason: "conflict" }`.

## Known gaps

- Partial spend: model calls that fail (non-2xx), time out or are aborted record nothing, although Anthropic may bill part of them. A workmap rebuild that loses the race to its 40 s budget records nothing either. The recorded cost is a lower bound.
- Voice trust: voice seconds are reported by the client. Part 3 binds each report to a server-issued token (`session_id`); the partial unique index `usage_events_voice_token` on `(workspace_id, session_id) where kind = 'voice'` allows one row per token per workspace. Voice rows without `voice_seconds` are not summed.

## Frames are not priced

Frame rows report `bytes` with `chf` null and never count as unpriced. A frame is written once and kept for the retention period, so a per-day storage price is undefined.

## Prices

Seeded `valid_from` 2026-10-01 from roadmap 3.7 USD list prices times a placeholder factor of 0.90 USD->CHF:

| model | input | output | cache read (CHF per million tokens) |
| --- | --- | --- | --- |
| claude-haiku-4-5-20251001 | 0.90 | 4.50 | 0.09 |
| claude-sonnet-5-5 | 2.70 | 13.50 | 0.27 |
| claude-opus-5-5 | 3.60 | 18.00 | 0.36 |

Voice: 0.072 CHF per minute (0.08 USD x 0.90).

Review the FX factor and the list prices by 2027-01-01. Change prices with a new migration inserting rows with a later `valid_from`; never edit the seed. `src/lib/usage/prices.test.ts` fails when a model id in `src/lib/models.ts` has no price row.

The price tables are readable by any signed-in user (`using (auth.uid() is not null)`, not `using (true)`, which the migration lint rejects). Only migrations write them.

## Rollback

The rollback destroys billing history (all events and prices). Order: view, policies, price tables, indexes, `usage_events`.

## Voice

Part 3. Route `src/app/api/voice/usage/route.ts`, helper `src/lib/usage/voice.ts`, client `src/lib/voice/useVoiceAgent.ts`.

The server never sees the ElevenLabs session length, so voice seconds come from the client. Each report is bound to a token the server issued and stored, so an invented token cannot add cost.

### Token flow

1. `GET /api/voice/signed-url` gets the ElevenLabs signed URL, then (supabase mode, `USAGE_EVENTS` not `0`) inserts a `usage_events` row `kind = 'voice'`, `session_id = v_<uuid>`, `voice_seconds` null through `insertUsageEvent`, and adds `usage_token` to the response. If the insert fails (error, conflict, missing table, timeout) the response has no `usage_token`, the signed URL still works, and one `usage.events` warn is logged. Metering never blocks voice. Local mode and `USAGE_EVENTS=0` issue no token.
2. `useVoiceAgent` keeps the token and the session start time. On session end (`stop()` or the SDK `onDisconnect`) or on window `pagehide` it posts `{ usage_token, seconds }` once to `POST /api/voice/usage` with `navigator.sendBeacon` (JSON Blob), or `fetch` with `keepalive: true` when sendBeacon is missing or refuses. A sent flag stops a second post. No token, no post. The post never throws into the hook.
3. `POST /api/voice/usage` (any member role) checks the body: `usage_token` must match `^v_[0-9a-f-]{36}$` and `seconds` must be a finite number, else 400 `{ error: "invalid body" }`. Seconds are clamped to 0..7200. One UPDATE with the service role client sets `voice_seconds` where `kind = 'voice'`, `session_id` is the token, `workspace_id` is the active workspace, `user_id` is the caller and `voice_seconds is null`. 200 `{ ok: true, seconds }`. Local mode answers 200 `{ ok: true, local: true }` without touching the DB.

### 404 and 409

When no row was updated, one select scoped to the caller's workspace and user tells the cases apart:

- 404 `{ error: "unknown token" }`: no such row for this workspace and user. Invented tokens, tokens of another workspace and tokens of another user look the same, so the route never confirms that a row exists elsewhere.
- 409 `{ error: "already recorded" }`: the caller's row exists and already has seconds. The first report wins.

A DB error answers 503 with one `usage.events` warn.

### No extra cap

There is no daily cap on this route. `usage_counters` already caps signed-url calls per workspace per day, and each signed URL yields at most one token and one report.

### Trust gap

A member can under-report their own session (send 0, or never post). They cannot inflate cost beyond 7200 s per issued token, and cannot touch tokens of other users or workspaces.

### Rows with null seconds

A voice row with `voice_seconds` null is a session that never reported: tab killed before pagehide fired, beacon dropped, or the microphone was denied after the token was issued. `usage_cost_daily` leaves these rows out. Count them to see how many sessions went unmetered:

```sql
select workspace_id, count(*) as unreported
from public.usage_events
where kind = 'voice' and voice_seconds is null and created_at >= '2026-10-01'
group by workspace_id;
```
