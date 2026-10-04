# Voice setup (ElevenLabs Agents)

One-time dashboard setup for the two voice agents. Code: `src/lib/voice/`, route `src/app/api/voice/signed-url/route.ts`.

## 1. API key

1. elevenlabs.io -> profile -> API Keys -> create a key with Conversational AI (Agents) access.
2. Put it in `.env.local` as `ELEVENLABS_API_KEY=...`. Never commit it. The key stays on the server; the browser only gets a signed URL.

## Create the agents by script

Instead of sections 2 to 4 you can create both agents through the API:

```
node scripts/create-agents.mjs --dry-run   # prints the two request bodies, no key, no network
node scripts/create-agents.mjs             # needs ELEVENLABS_API_KEY in .env.local (or SPIKE_ENV_FILE)
```

It lists existing agents first and reuses any agent already named `Apprentice Interviewer` or `Apprentice Tutor`, so a rerun does not create duplicates. It sets the prompts and first messages from `prompts.ts`, the voices (Sarah for the interviewer, George for the tutor), English, the client tools from section 3, the tutor dynamic variables, the overrides and authentication from section 4. LLM defaults to `gemini-2.5-flash` (`AGENT_LLM` overrides), TTS to `eleven_v3_conversational` with Expressive Mode (`AGENT_TTS_MODEL` overrides).

On success it prints one `created` or `reused` line per agent and two lines to paste into `.env.local`:

```
ELEVENLABS_AGENT_ID_INTERVIEWER=agent_...
ELEVENLABS_AGENT_ID_TUTOR=agent_...
```

On an API error it prints the HTTP status and the response body verbatim and exits non-zero; an agent created before the error is listed and reused on the next run. The dashboard steps below remain valid as the manual path.

## 2. Create the agents

In the dashboard go to Agents -> Create agent -> Blank agent. Do this twice:

| Agent name | System prompt | First message |
|---|---|---|
| `Apprentice Interviewer` | `INTERVIEWER_PROMPT` in `src/lib/voice/prompts.ts` | `INTERVIEWER_FIRST_MESSAGE` |
| `Apprentice Tutor` | `TUTOR_PROMPT` | `TUTOR_FIRST_MESSAGE` |

For each agent:

1. Agent tab -> System prompt: paste the prompt text (the content between the backticks).
2. Agent tab -> First message: paste the first message.
3. Agent tab -> Language: English.
4. Agent tab -> LLM: pick a fast model (Gemini Flash or GPT-4o mini class). Latency matters more than depth here; the prompts are simple.
5. Voice tab: pick a calm voice. Leave turn timeout at the default.
6. Tutor only: Agent tab -> Dynamic variables: add `expert` (string) and `work_map` (string). The app fills them at session start via `start({ dynamicVariables })`.

## 3. Client tools

Agent tab -> Tools -> Add tool -> Client. For every tool turn on **Wait for response**. Names must match exactly.

Interviewer:

- `set_off_record`
  - Description: Pause or resume recording when the expert says "off the record" or "back on the record".
  - Parameters: `active` (boolean, required): true to pause, false to resume.
- `confirm_teach_back`
  - Description: Report whether the expert confirmed the teach-back summary.
  - Parameters: `confirmed` (boolean, required); `correction` (string, optional): the expert's correction in their own words.

Tutor:

- `replay_moment`
  - Description: Show the learner the original screen moment for a step.
  - Parameters: `step_n` (number, required): the Work Map step number.

The app registers handlers with the same names through `useVoiceAgent({ clientTools })`. A handler returns a short string that goes back to the agent.

## 4. Security tab

Agents -> (agent) -> Security:

1. Enable overrides for System prompt, First message and Language. Without this the app cannot send prompt overrides; the pasted prompt is used.
2. Authentication: enable it, so only signed URLs from our server can start a session.

## 5. Agent ids

Copy each agent id (Agent page header or URL, `agent_...`) into `.env.local`:

```
ELEVENLABS_API_KEY=...
ELEVENLABS_AGENT_ID_INTERVIEWER=agent_...
ELEVENLABS_AGENT_ID_TUTOR=agent_...
```

Set the same three variables in Vercel (Project -> Settings -> Environment Variables). `GET /api/voice/signed-url?role=interviewer` returns `503 {error:'missing_env', missing:[...]}` until they are set.

## How the app drives the agents

- `injectContext(text)` -> `sendContextualUpdate`: adds context, the agent does not speak.
- `promptTurn(text)` -> `sendUserMessage`: a user turn, the agent replies. Used for `[SCREEN_EVENT]`, `[DEBRIEF]`, `[TEACH_BACK]`, `[PREDICT]`, `[GUARDRAIL_STOP]`, `[MASTERY]` turns built in `prompts.ts`.
- `noteUserActivity()` -> `sendUserActivity`: the expert is busy, the agent holds back.
- `setMuted(true)` stops sending microphone audio and drops all transcript callbacks (off the record).

## Differences from the scouted facts (SDK @elevenlabs/react 1.16.0)

- `useConversation` must be rendered inside `<ConversationProvider>`. `useVoiceAgent.ts` re-exports it as `VoiceProvider`; wrap the Capture and Learn pages in it.
- `startSession` returns `void` in 1.x (no conversation id promise). Use `onConnect` or `getId()` if an id is needed.
- `onMessage` payloads carry `role: 'user' | 'agent'` (`source` is deprecated). The hook maps `user` to `expert` for the interviewer and to `learner` for the tutor.
- Mic mute is a controlled `micMuted` prop plus `setMuted`. While muted the agent cannot hear "back on the record", so the UI needs a resume control that calls `setMuted(false)` (and should tell the agent via `injectContext`).
