# Cost meter (part 1 of 3: schema, prices, recorder)

Migration `supabase/migrations/20261006000000_usage_events.sql`, rollback `supabase/rollbacks/20261006000000_usage_events.down.sql`, recorder `src/lib/usage/events.ts`.

`usage_counters` (daily caps) counts calls. `usage_events` records tokens, voice seconds and frame bytes per call, and `usage_cost_daily` prices them in CHF. Part 1 adds no callers: part 2 wires vision, decide and workmap plus the cost route and CostCard, part 3 wires voice.

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

Part 1 alone is safe in any order: nothing calls `recordUsage` yet.

## Kill switch

`USAGE_EVENTS=0` turns recording off (no insert, no `after()` scheduled). Local mode never records.

## Missing table backoff

If the table is missing (Postgres 42P01 or PostgREST PGRST205), the recorder logs one `usage.events` warn with reason `table_missing` and skips inserts for 5 minutes, then tries again. Applying the migration needs no restart.

## Failure behaviour

`recordUsage` returns at once and inserts after the response through `after()` from `next/server`, with the service role client. Each insert is aborted after 5000 ms. A failed, rejected or aborted insert, or a call outside a request scope (`no_request_scope`), logs exactly one `usage.events` warn and is dropped. It never throws to the caller. `insertUsageEvent` is the awaited variant for part 3 and maps 23505 to `{ ok: false, reason: "conflict" }`.

## Known gaps

- Partial spend: model calls that fail, time out or are aborted are not recorded here. Filled by part 2.
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
