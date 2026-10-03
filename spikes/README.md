# Spikes (BUILD_SPEC section 11, hours 0-2)

Throwaway scripts. Plain `.mjs`, Node 26 built-ins only (global `fetch`, `process.loadEnvFile`), no npm dependencies.

Each script loads `../.env.local` (repo root) if it exists. Set `SPIKE_ENV_FILE=/path/to/.env.local` to load a different file. Keys are never printed.

Exit codes: `0` PASS, `1` FAIL (with reason), `2` SKIP (key missing).

## b: Jev decide() call

Proves one `POST https://api.typesafe.ai/v1/systemone` call answers three questions about one event and returns the fields we expect:

- `event_class` (choice: routine / judgment_call / possible_guardrail)
- `screen_explains_it` (noul, yes/no probability)
- `ask_timing` (choice: ask_now / wait / save_for_debrief)

Event: cost center of invoice 4471 (hydraulic press, EUR 7,400) changed from 4711 (opex) to 0400 (capex); expert silent for 3 s.

Timeout 5 s, one retry after 0.5 s on HTTP 429/529 only. Prints raw answers, latency, and whether `confidence` is present and `noul` is in [0, 1].

```sh
node spikes/b-jev.mjs              # Jev (needs JEV_API_KEY)
node spikes/b-jev.mjs --fallback   # Anthropic Messages API JSON fallback (needs ANTHROPIC_API_KEY)
```

Without `JEV_API_KEY` but with `ANTHROPIC_API_KEY`, the script uses the fallback automatically. Fallback model: `DECIDE_MODEL`, default `claude-haiku-4-5-20251001`, `output_config.format` json_schema.

PASS looks like:

```
latency_ms: 412
PASS: jev answered all three questions with the expected fields
```

or `PASS (fallback): all three questions answered`.

## c: one frame to ScreenEvent JSON

Proves a single screenshot of an AP invoice screen turns into a valid `{ events: [...] }` object via the Messages API with an image block and `output_config.format` json_schema. Event types: `record_opened`, `field_changed`, `button_clicked`, `status_changed`. The reply is validated by hand (array, type in enum case-insensitive, `entity.kind` and `entity.id` strings, refusal handled).

```sh
node spikes/c-vision.mjs                          # default fixture spikes/fixtures/invoice-frame.png
node spikes/c-vision.mjs path/to/frame.jpg        # any png/jpg/webp/gif
```

Model: `VISION_MODEL`, default `claude-haiku-4-5-20251001`. Needs `ANTHROPIC_API_KEY`.

PASS looks like:

```
latency_ms: 2310
input_tokens: 1580 output_tokens: 140
PASS: 3 valid event(s)
```

Fixture: `fixtures/invoice.html` (fake invoice 4471, Hydrotek Maschinen GmbH, EUR 7,400.00, cost center 0400, empty asset number, Save / Hold / Send for 2nd approval). Rendered to `fixtures/invoice-frame.png` (1280x800) with:

```sh
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --hide-scrollbars \
  --screenshot="$PWD/spikes/fixtures/invoice-frame.png" --window-size=1280,800 \
  "file://$PWD/spikes/fixtures/invoice.html"
```

## Results

| spike | date | result | notes |
|---|---|---|---|
| a | | not run yet | |
| b | | not run yet | no .env.local at main checkout on 2026-10-03; SKIP path verified only |
| c | | not run yet | no .env.local at main checkout on 2026-10-03; SKIP path verified only |
