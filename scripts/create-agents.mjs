// Creates the two ElevenLabs agents (Apprentice Interviewer, Apprentice Tutor) through the API.
// Replaces docs/VOICE_SETUP.md sections 2 to 4. Safe to rerun: agents that already exist by name are reused.
// Usage: node scripts/create-agents.mjs [--dry-run]
// Env: ELEVENLABS_API_KEY (from SPIKE_ENV_FILE or ./.env.local), optional AGENT_LLM, AGENT_TTS_MODEL.
// Node built-ins only (needs Node with TypeScript type stripping to import the .ts modules). Never prints the key.
//
// Request shape verified on 2026-10-03 against:
//   https://elevenlabs.io/docs/api-reference/agents/create
//   https://api.elevenlabs.io/openapi.json (also for GET /v1/convai/agents: page_size <= 100, cursor, has_more)
//     (Body_Create_Agent_v1_convai_agents_create_post, AgentConfigAPIModel-Input, PromptAgentAPIModel-Input,
//      ClientToolConfig-Input, LiteralJsonSchemaProperty, DynamicVariablesConfig, TTSConversationalConfig-Input,
//      AgentPlatformSettingsRequestModel, AgentConfigOverrideConfig, AuthSettings, GetAgentsPageResponseModel)
// Notes from the reference:
//   - prompt.tools (inline tools) is marked deprecated in favour of tool_ids, but is still accepted. Inline keeps
//     this a single call per agent. If the API rejects it, create the tools via /v1/convai/tools and pass tool_ids.
//   - tts.expressive_mode is documented (default true, only applies to v3 models), so the TTS model is set to
//     eleven_v3_conversational. Override with AGENT_TTS_MODEL.
//   - prompt.llm default is gemini-2.5-flash; we set it explicitly. Override with AGENT_LLM.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as prompts from '../src/lib/voice/prompts.ts';
import { buildAgentBodies, INTERVIEWER_NAME, TUTOR_NAME } from '../src/lib/voice/createAgents.ts';

const API = 'https://api.elevenlabs.io/v1/convai/agents';
const here = path.dirname(fileURLToPath(import.meta.url));
const dryRun = process.argv.includes('--dry-run');

const bodies = buildAgentBodies(prompts, {
  llm: process.env.AGENT_LLM,
  ttsModel: process.env.AGENT_TTS_MODEL,
});

if (dryRun) {
  console.log(JSON.stringify(bodies.interviewer, null, 2));
  console.log(JSON.stringify(bodies.tutor, null, 2));
  process.exit(0);
}

const envFile = process.env.SPIKE_ENV_FILE || path.join(here, '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);
const apiKey = process.env.ELEVENLABS_API_KEY;
if (!apiKey) {
  console.error(`ELEVENLABS_API_KEY not set (looked in ${envFile} and the environment)`);
  process.exit(2);
}

class HttpError extends Error {
  constructor(what, status, text) {
    super(`${what}: HTTP ${status}`);
    this.status = status;
    this.text = text;
  }
}

async function call(what, url, init = {}) {
  const res = await fetch(url, {
    ...init,
    headers: { 'xi-api-key': apiKey, 'content-type': 'application/json', ...init.headers },
    signal: AbortSignal.timeout(30_000),
  });
  const text = await res.text();
  if (!res.ok) throw new HttpError(what, res.status, text);
  return text ? JSON.parse(text) : {};
}

async function listAgents() {
  const all = [];
  let cursor = null;
  do {
    const q = new URLSearchParams({ page_size: '100' });
    if (cursor) q.set('cursor', cursor);
    const page = await call('list agents', `${API}?${q}`);
    all.push(...(page.agents ?? []));
    cursor = page.has_more ? page.next_cursor : null;
  } while (cursor);
  return all;
}

const results = []; // { role, name, id, action }

function report() {
  for (const r of results) console.log(`${r.name}: ${r.action} ${r.id}`);
}

try {
  const existing = await listAgents();
  const plan = [
    { role: 'INTERVIEWER', name: INTERVIEWER_NAME, body: bodies.interviewer },
    { role: 'TUTOR', name: TUTOR_NAME, body: bodies.tutor },
  ];
  for (const p of plan) {
    const found = existing.filter((a) => a.name === p.name);
    if (found.length > 1) console.error(`warning: ${found.length} agents named '${p.name}', reusing the first`);
    if (found.length) {
      results.push({ role: p.role, name: p.name, id: found[0].agent_id, action: 'reused' });
      continue;
    }
    const created = await call(`create '${p.name}'`, `${API}/create`, {
      method: 'POST',
      body: JSON.stringify(p.body),
    });
    if (typeof created.agent_id !== 'string') {
      throw new HttpError(`create '${p.name}': response had no agent_id`, 200, JSON.stringify(created));
    }
    results.push({ role: p.role, name: p.name, id: created.agent_id, action: 'created' });
  }
} catch (err) {
  report();
  if (results.length) console.error('Agents above exist now; a rerun reuses them.');
  if (err instanceof HttpError) {
    console.error(`${err.message}`);
    console.error(err.text);
  } else {
    console.error(err instanceof Error ? err.message : String(err));
  }
  process.exit(1);
}

report();
for (const r of results) console.log(`ELEVENLABS_AGENT_ID_${r.role}=${r.id}`);
if (process.env.AGENT_TTS_MODEL) console.log(`TTS model ${process.env.AGENT_TTS_MODEL}; Expressive Mode only applies to v3 models.`);
