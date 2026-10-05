# Subprocessors (DRAFT)

> UNPUBLISHED DRAFT. See [README](README.md). Derived from the code; re-check before publishing.

[entity to be founded] uses these vendors to run [product name]. Hosting region for Supabase and Vercel: [US or EU, to be decided].

| Vendor | Purpose | Data categories | Region | DPA | Code |
|---|---|---|---|---|---|
| Supabase | Auth, Postgres database, file storage | Account email, user id, frames, transcripts, screen events, Work Maps, teach progress, usage counters, agent settings | [US or EU, to be decided] | [DPA link] | `src/lib/store/supabase.ts`, `src/app/api/auth/**` |
| Vercel | Hosting, serverless functions, cron jobs (daily retention) | All request data in transit, function logs | [US or EU, to be decided]; edge network global | [DPA link] | `src/app/api/**`, `src/app/api/cron/retention/route.ts` |
| Anthropic | Vision on screen frames, next-question decisions, Work Map synthesis, process matching | Screen frames, redacted transcripts and screen events, Work Map text | US | [DPA link] | `src/lib/perception/vision.ts`, `src/lib/decide/llm.ts`, `src/lib/workmap/synthesize.ts`, `src/lib/processes/matchLlm.ts` |
| ElevenLabs | Voice agents (speech to text, text to speech, conversation) | Session voice audio, transcripts, agent prompts | [US or EU, per ElevenLabs account] | [DPA link] | `src/app/api/voice/**`, `src/lib/voice/createAgents.ts` |
| Google (via ElevenLabs) | LLM behind the ElevenLabs voice agent (`gemini-2.5-flash`), called by ElevenLabs on our behalf | Conversation text during a voice session | US | [DPA link, through ElevenLabs] | `src/lib/voice/createAgents.ts` (`DEFAULT_LLM`) |
| GitHub | Distribution of desktop app releases | Download request metadata (IP address, user agent) | US | [DPA link] | `src/lib/downloads.ts` |
| Sentry (once enabled) | Error tracking | Error messages, stack traces, request metadata, user id | EU | [DPA link] | not wired yet |
| Presidio (optional, self-hosted) | PII detection for text redaction when `PRESIDIO_URL` is set | Transcript and screen event text | Same as our hosting; no third-party vendor | n/a | `src/lib/redact/index.ts` |
| Jev / TypeSafe AI (optional) | Alternative decision engine, only when `JEV_API_KEY` is set | Redacted transcripts and screen events | [region] | [DPA link] | `src/lib/decide/jev.ts`, `src/lib/decide/index.ts` |

Changes: we will announce new subprocessors to workspace owners [number] days in advance; see [dpa-template.md](dpa-template.md).
