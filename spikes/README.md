# Spikes (BUILD_SPEC section 11, hours 0-2)

Throwaway scripts. Plain `.mjs`, Node 26 built-ins only (global `fetch`, `WebSocket`, `process.loadEnvFile`), no npm dependencies.

Each script loads `../.env.local` (repo root) if it exists. Set `SPIKE_ENV_FILE=/path/to/.env.local` to load a different file. Keys are never printed.

Exit codes: `0` PASS, `1` FAIL (with reason), `2` SKIP (key missing).

## a: ElevenLabs agent replies after an injected screen event

Checks whether the interviewer agent can be pushed into speaking by a screen event over the raw Conversational AI WebSocket in text-only mode (risk table section 15).

```sh
node spikes/a-elevenlabs.mjs           # text only (conversation.text_only override)
node spikes/a-elevenlabs.mjs --voice   # no text_only override; audio chunks are counted, not played
```

Needs `ELEVENLABS_API_KEY` and `ELEVENLABS_AGENT_ID_INTERVIEWER`. The script gets a signed URL via `GET /v1/convai/conversation/get-signed-url` (`xi-api-key` header). On a 4xx it falls back to the public agent URL `wss://api.elevenlabs.io/v1/convai/conversation?agent_id=...`. It never prints the key or the signed URL.

Flow:

1. Send `conversation_initiation_client_data` with `{"conversation":{"text_only":true}}` and wait up to 10 s for `conversation_initiation_metadata`. If the agent has a first message, log it.
2. Phase A: send `contextual_update` (`[SCREEN_EVENT] cost center of invoice 4471 changed ...`) and wait 6 s. The docs say this does not trigger a reply.
3. Phase B: send `user_message` (`[SCREEN_EVENT] The expert just changed ... Ask one short question about why.`) and wait up to 15 s for `agent_response`. Record the latency.
4. Close and print the verdict block.

The whole time, each `ping` gets a `pong` with the same `event_id`, and each `client_tool_call` gets a `client_tool_result` of `ok`.

Dashboard prerequisites:

- Create the interviewer agent in the ElevenLabs Agents dashboard and put its id in `ELEVENLABS_AGENT_ID_INTERVIEWER`.
- If the server rejects `text_only` (the script prints the close code and reason), go to the agent's Security tab, enable overrides (text only / conversation overrides) and run it again.
- A private agent needs the API key for the signed URL. Without a signed URL the agent has to be public.

PASS means phase B produced an `agent_response` that mentions the invoice, the cost center or capex (case-insensitive). FAIL prints the reason, including the server close code and reason when there is one. Verdict block:

```
--- verdict ---
mode: text_only
contextual_update_alone_triggers_reply: no
user_message_triggers_reply: yes
latency_ms: 840
reply: "Why did you move invoice 4471 to capex?"
PASS: phase B reply mentions the invoice, the cost center or capex
```

Mitigation (section 15): the synthetic user turn (phase B) IS the mechanism the app will use to make the agent speak after a screen event. `contextual_update` only adds background context.

Deviations from the scout T-0003 facts: none observed in the 2026-10-03 run.

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
| a | 2026-10-03 | PASS | run by the Planner against the real ElevenLabs API: voice agent session replied after the injected screen event |
| b | 2026-10-03 | PASS | run by the Planner against the real API: decide call answered all three questions |
| c | 2026-10-03 | PASS | run by the Planner against the real Anthropic API: vision on a real frame returned valid events |
