# decisions

## 2026-10-03 ElevenLabs Agents SDK: making the agent speak after an injected screen event
type: discovery · goal: T-0001 · tasks: T-0003 · provenance: web
- bus:T-0003 — packages @elevenlabs/client (Conversation.startSession) and @elevenlabs/react (useConversation); startSession takes agentId or signedUrl (websocket) or conversationToken (webrtc)
- bus:T-0003 — sendContextualUpdate(text) does NOT trigger a reply (raw type contextual_update); sendUserMessage(text) DOES trigger an agent turn (raw type user_message); sendUserActivity() signals typing so the agent holds back about 2s
- bus:T-0003 — client tools: clientTools option in startSession (name to async handler) plus a Client tool of the same name in the dashboard with Wait for response on; tools are agent-initiated and cannot make it speak
- bus:T-0003 — signed url: GET api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=.. with xi-api-key (header assumed) returns signed_url; overrides (prompt, firstMessage, language) must be enabled in the agent Security tab
- bus:T-0003 — text-only raw WS wss://api.elevenlabs.io/v1/convai/conversation?agent_id=..; first send conversation_initiation_client_data with conversation_config_override.conversation.text_only true; read agent_response.agent_response_event.agent_response; answer ping with pong + event_id
outcome: Proactive question = contextual update with the event plus a synthetic sendUserMessage turn; rejected: contextual update alone (no reply) and client tools (agent-initiated). Unverified: package versions, onVadScore, Scribe realtime WS path, text_only override toggle. Revert: memory note only

## 2026-10-03 Jev (TypeSafe AI) API shape and Anthropic structured vision output
type: discovery · goal: T-0001 · tasks: T-0004,T-0005 · provenance: repo
- bus:T-0004 — POST https://api.typesafe.ai/v1/systemone, Authorization Bearer key, body has state (string), model jev-latest, questions keyed by name, each with type noul, choice or score, instructions, criteria; choice criteria is an object keyed by option, score criteria a list of levels
- bus:T-0004 — response has answers keyed by name: noul, or choice + probabilities + confidence, or score + confidence; plus usage; retry once on 429/529; score range unknown until spike b runs
- bus:T-0005 — Anthropic Messages API: base64 image block before text; schema JSON via output_config.format type json_schema, additionalProperties false, no min/max keywords; fast model claude-haiku-4-5-20251001 (retires not before 2026-10-15), fallback claude-sonnet-5-5
outcome: App uses plain fetch for Jev and Anthropic (no SDK dependency, avoids package.json merge conflicts between parallel workstreams); this repo env name is JEV_API_KEY (the orchestrator client uses TYPESAFE_API_KEY). Revert: memory note only

## 2026-10-06 Phase 0 (T-0280): no legal entity, personal Apple account, local-stack DB tests, Sentry behind env, frames only for non-routine events
type: decision · goal: T-0280 · tasks: T-0281,T-0284,T-0287,T-0288,T-0295 · provenance: repo
- .orchestrator/roadmap.md:247 — Phase 0 rows P0-1..P0-12 are the goal scope; human 2026-10-06: general tool for any team, English-first, Teach opt-in and private, frames = redacted key moments only
- .orchestrator/plan.md:1 — human 2026-10-06 (via orchestrator-f0 session): no legal entity exists; legal texts stay unpublished drafts with [entity to be founded] placeholders; nothing in a company name (VAT, billing, Apple organisation)
- docs/RELEASE.md (T-0295) — macOS signing on the human's personal Apple Developer account: Developer ID Application certificate + notarytool with an App Store Connect API key; agents get tokens only via orchestrator/scripts/with-tokens.sh allowlist (today only elevenlabs-api-key)
- db-tests/ (T-0281) — real-database RLS tests run on the Supabase CLI local stack in GitHub Actions, not a paid staging project; rejected: staging-only tests (needs spend and secrets before any test runs)
- src/app/api/vision/route.ts (T-0284) — describe first, store a frame only when an event is non-routine; rejected: a new purge path after Work Map confirm (would add a deletion path the human must approve)
outcome: Revert path: git revert -m 1 <merge sha of PR goal/T-0280> after merge; before merge, delete branch goal/T-0280 and the T-0281..T-0297 tasks are superseded. Planner commits of .orchestrator/* on goal/T-0280: git revert <sha>.
