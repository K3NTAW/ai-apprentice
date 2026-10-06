# Measured unit cost (P0-10)

Replaces the estimates in roadmap section 3.7 (about 11 USD per capture hour including debrief, about 10 USD per teach hour) with measured CHF from 10 scripted sessions on staging.

Script `scripts/measure-cost.mjs`, aggregation `scripts/lib/cost.mjs` (`summarise`, tests in `scripts/lib/cost.test.mjs`). Data comes from the cost meter (`docs/checks/cost-meter.md`): `usage_events`, `sessions`, `model_prices`, `voice_prices`.

**The human runs this on staging and pastes the results below.** Running the sessions spends API money (vision, voice, decide, workmap). Nothing here runs in CI.

## Before you start

- Staging has the cost meter migration (`20261006000000_usage_events.sql`) and parts 2 and 3 deployed. `USAGE_EVENTS` is not `0`.
- Use a fresh staging workspace used only for this measurement, so no other traffic lands in the window.
- Note the start time in UTC (ISO, for example `2026-10-08T07:00:00Z`).
- Use the default models (no `VISION_MODEL` or `DECIDE_MODEL` override) and write down what they resolve to.

## Protocol (10 sessions)

Same general sample task in every session, nothing industry-specific:

> File five expense receipts in a spreadsheet: open each receipt (PDF or image), type date, vendor, amount and category into a new row, save the file.

Prepare five sample receipts and an empty spreadsheet once and reuse them for every session.

1. **Capture plus debrief, 5 sessions.** Start a capture, do the task while narrating by voice as an expert would, end the capture, then run the debrief to the end (Work Map synthesis and any rebuilds). Aim for 10 to 15 minutes of capture each. Vary nothing on purpose; small natural variation is the point.
2. **Teach, 5 sessions.** Use the process confirmed from capture session 1. Start a teach session as a learner and do the same task with the voice guide connected the whole time. Make one or two deliberate mistakes per session so decide and the fallback run.
3. End every session properly (do not just close the window), so `ended_at` is set and the voice seconds are reported.
4. Wait 2 minutes after the last session, then run the script.

## Commands

The service role key is read from the environment and never printed. Do not paste it into this doc, a shell history file or a commit.

```sh
export SUPABASE_URL=https://<staging-ref>.supabase.co
read -rs SUPABASE_SERVICE_ROLE_KEY && export SUPABASE_SERVICE_ROLE_KEY   # paste, Enter

node scripts/measure-cost.mjs --workspace <workspace-uuid> --since <start-iso> --until <end-iso>
node scripts/measure-cost.mjs --workspace <workspace-uuid> --since <start-iso> --until <end-iso> --json > /tmp/unit-cost.json

unset SUPABASE_SERVICE_ROLE_KEY
```

Optional: `STORAGE_CHF_PER_GB_MONTH` (default 0.0189, that is 0.021 USD x 0.90) and `RETENTION_MONTHS` (default 3) price stored frames.

## How the numbers are made

- Minutes: `ended_at - started_at`; an open session uses its last event.
- Vision, decide and workmap rows carry the session id. Voice rows carry the voice usage token, so a voice row goes to the session of the same user whose window (start - 5 min to end + 5 min) contains it. Rows that match nothing are listed as unattributed.
- Prices: the latest `model_prices` / `voice_prices` row valid on the Europe/Zurich day of the event, same as `usage_cost_daily`. A model without a price row is costed 0, listed under "Unpriced" and the session is marked partial. Fix it with a price row in a new migration and rerun.
- Storage: frame bytes x storage price x retention months.
- Per kind: CHF per hour per session, then min, median and max over the sessions of that kind, and the share of vision, voice, decide, workmap and storage in the kind's total.
- Not included: fixed monthly costs (Supabase, Vercel, ElevenLabs plan), the ElevenLabs agent LLM (billed separately, roadmap 3.7 assumes about 0.005 USD/min), egress and function invocations. Note them separately if the invoices show them.
- Currency: CHF from the seeded prices (USD list x 0.90 placeholder factor). Roadmap 3.7 is in USD; the comparison columns convert with the same 0.90.

## Results (paste here)

Date run: `YYYY-MM-DD`, staging commit: `<sha>`, workspace: `<uuid>`, window: `<since>` to `<until>`, models: vision `<id>`, decide `<id>`, workmap `<id>`.

### Per session

| session | kind | minutes | vision calls | decide | workmap | tokens in | tokens out | cache read | voice s | frames | frame MB | CHF | CHF/h |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | capture | | | | | | | | | | | | |
| | capture | | | | | | | | | | | | |
| | capture | | | | | | | | | | | | |
| | capture | | | | | | | | | | | | |
| | capture | | | | | | | | | | | | |
| | teach | | | | | | | | | | | | |
| | teach | | | | | | | | | | | | |
| | teach | | | | | | | | | | | | |
| | teach | | | | | | | | | | | | |
| | teach | | | | | | | | | | | | |

### Per hour, compared with roadmap 3.7

| kind | sessions | CHF/h min | CHF/h median | CHF/h max | 3.7 estimate (USD/h) | 3.7 estimate (CHF/h, x 0.90) | median vs estimate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| capture, incl. debrief | 5 | | | | about 11 (range 8 to 14) | about 9.90 (7.20 to 12.60) | |
| teach | 5 | | | | about 10 | about 9.00 | |

### Share per item, compared with roadmap 3.7

| item | capture share | teach share | 3.7 capture estimate (USD/h) | 3.7 teach estimate (USD/h) |
| --- | --- | --- | --- | --- |
| vision | | | 2.40 to 7.20 (typical 5.80) | included in about 10 |
| voice | | | about 5.10 | about 5.10 |
| decide | | | about 0.50 | about 0.50 |
| workmap | | | about 0.75 per session | none |
| storage | | | under 0.10 | under 0.10 |

### Notes

- Unpriced or unattributed rows reported by the script:
- Anything unusual in the sessions (reconnects, crashes, long silences):
- Conclusion (does section 3.7 hold, which lever matters most):
