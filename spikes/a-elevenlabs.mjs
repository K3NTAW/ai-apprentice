// Spike a: does the ElevenLabs agent reply after an injected screen event? Raw WebSocket, text only.
// Usage: node spikes/a-elevenlabs.mjs [--voice]
// Throwaway. Node built-ins only. Never prints key values or the signed URL.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.SPIKE_ENV_FILE || path.join(here, '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const voice = process.argv.includes('--voice');
const API = 'https://api.elevenlabs.io/v1/convai/conversation';

const CONTEXT_TEXT = '[SCREEN_EVENT] cost center of invoice 4471 changed from 4711 (opex) to 0400 (capex)';
const USER_TEXT =
  '[SCREEN_EVENT] The expert just changed the cost center of invoice 4471 from 4711 to 0400 and has paused. ' +
  'Ask one short question about why.';
const MATCH = /invoice|cost cent(er|re)|capex/i;

const t0 = Date.now();
function log(msg) {
  const t = String(Date.now() - t0).padStart(6, ' ');
  console.log(`[${new Date().toISOString()} +${t}ms] ${msg}`);
}

for (const key of ['ELEVENLABS_API_KEY', 'ELEVENLABS_AGENT_ID_INTERVIEWER']) {
  if (!process.env[key]) {
    console.log(`SKIP: ${key} not set`);
    process.exit(2);
  }
}
const apiKey = process.env.ELEVENLABS_API_KEY;
const agentId = process.env.ELEVENLABS_AGENT_ID_INTERVIEWER;

async function connectUrl() {
  const res = await fetch(`${API}/get-signed-url?agent_id=${encodeURIComponent(agentId)}`, {
    headers: { 'xi-api-key': apiKey },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) {
    const body = await res.json();
    if (typeof body?.signed_url === 'string') {
      log('signed url: ok (not printed)');
      return body.signed_url;
    }
    log('signed url: response had no signed_url, falling back to public agent url');
  } else if (res.status >= 400 && res.status < 500) {
    log(`signed url: HTTP ${res.status}, falling back to public agent url`);
  } else {
    throw new Error(`get-signed-url HTTP ${res.status}`);
  }
  return `${API.replace('https://', 'wss://')}?agent_id=${encodeURIComponent(agentId)}`;
}

const state = {
  initialized: false,
  closed: null, // { code, reason }
  responses: [], // { at, text }
  audioChunks: 0,
  waiters: [],
};

function notify() {
  for (const w of [...state.waiters]) w();
}

// Resolves with true when pred() holds, false on timeout or close.
function waitFor(pred, timeoutMs) {
  return new Promise((resolve) => {
    const check = () => {
      if (pred()) return done(true);
      if (state.closed) return done(false);
    };
    const timer = setTimeout(() => done(pred()), timeoutMs);
    function done(v) {
      clearTimeout(timer);
      state.waiters = state.waiters.filter((w) => w !== check);
      resolve(v);
    }
    state.waiters.push(check);
    check();
  });
}

function send(ws, msg) {
  ws.send(JSON.stringify(msg));
  log(`sent ${msg.type}`);
}

function handle(ws, raw) {
  let msg;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'));
  } catch {
    log('received non-JSON frame (ignored)');
    return;
  }
  switch (msg.type) {
    case 'conversation_initiation_metadata':
      state.initialized = true;
      log(`received conversation_initiation_metadata (conversation_id ${msg.conversation_initiation_metadata_event?.conversation_id ?? '?'})`);
      break;
    case 'agent_response': {
      const text = msg.agent_response_event?.agent_response ?? '';
      state.responses.push({ at: Date.now(), text });
      log(`received agent_response: ${JSON.stringify(text)}`);
      break;
    }
    case 'ping': {
      const id = msg.ping_event?.event_id;
      ws.send(JSON.stringify({ type: 'pong', event_id: id }));
      log(`ping ${id} -> pong`);
      break;
    }
    case 'audio':
      state.audioChunks++;
      break;
    case 'client_tool_call': {
      const call = msg.client_tool_call ?? {};
      log(`received client_tool_call ${call.tool_name ?? '?'} -> client_tool_result ok`);
      ws.send(
        JSON.stringify({ type: 'client_tool_result', tool_call_id: call.tool_call_id, result: 'ok', is_error: false }),
      );
      break;
    }
    case 'interruption':
      log('received interruption');
      break;
    default:
      log(`received ${msg.type}`);
  }
  notify();
}

function verdict(v) {
  console.log('');
  console.log('--- verdict ---');
  console.log(`mode: ${voice ? 'voice' : 'text_only'}`);
  console.log(`contextual_update_alone_triggers_reply: ${v.phaseA ?? 'n/a'}`);
  console.log(`user_message_triggers_reply: ${v.phaseB ?? 'n/a'}`);
  console.log(`latency_ms: ${v.latencyMs ?? 'n/a'}`);
  console.log(`reply: ${v.reply === undefined ? 'n/a' : JSON.stringify(v.reply)}`);
  if (voice) console.log(`audio_chunks: ${state.audioChunks}`);
  if (state.closed && !(state.closed.code === 1000 && state.closed.reason === 'spike done'))
    console.log(`server_close: code ${state.closed.code} reason ${JSON.stringify(state.closed.reason)}`);
  if (v.fail) {
    console.log(`FAIL: ${v.fail}`);
    process.exit(1);
  }
  console.log('PASS: phase B reply mentions the invoice, the cost center or capex');
  process.exit(0);
}

function closeInfo() {
  return state.closed ? ` (server closed: code ${state.closed.code} reason ${JSON.stringify(state.closed.reason)})` : '';
}

let url;
try {
  url = await connectUrl();
} catch (err) {
  verdict({ fail: `could not get a connect url: ${err.message}` });
}

log('connecting');
const ws = new WebSocket(url);
url = undefined;
ws.addEventListener('message', (ev) => handle(ws, ev.data));
ws.addEventListener('error', () => log('websocket error'));
ws.addEventListener('close', (ev) => {
  state.closed = { code: ev.code, reason: ev.reason };
  log(`closed: code ${ev.code} reason ${JSON.stringify(ev.reason)}`);
  notify();
});

const opened = await new Promise((resolve) => {
  const timer = setTimeout(() => resolve(false), 10_000);
  ws.addEventListener('open', () => (clearTimeout(timer), resolve(true)), { once: true });
  ws.addEventListener('close', () => (clearTimeout(timer), resolve(false)), { once: true });
});
if (!opened) verdict({ fail: `websocket did not open within 10 s${closeInfo()}` });
log('open');

// Step 1: init.
send(ws, {
  type: 'conversation_initiation_client_data',
  conversation_config_override: voice ? {} : { conversation: { text_only: true } },
});
if (!(await waitFor(() => state.initialized, 10_000))) {
  verdict({ fail: `no conversation_initiation_metadata within 10 s${closeInfo()}` });
}
// Give a first message (if the agent has one) a moment to arrive before phase A.
await waitFor(() => state.responses.length > 0, 3_000);
if (state.responses.length) log(`first message: ${JSON.stringify(state.responses[0].text)}`);
else log('no first message within 3 s');

// Step 2: phase A, contextual_update alone.
let before = state.responses.length;
send(ws, { type: 'contextual_update', text: CONTEXT_TEXT });
await new Promise((r) => setTimeout(r, 6_000));
const phaseA = state.responses.length > before ? 'yes' : 'no';
log(`phase A: contextual_update triggered reply: ${phaseA}`);
if (state.closed) verdict({ phaseA, fail: `connection closed during phase A${closeInfo()}` });

// Step 3: phase B, synthetic user turn.
before = state.responses.length;
const sentAt = Date.now();
send(ws, { type: 'user_message', text: USER_TEXT });
const gotB = await waitFor(() => state.responses.length > before, 15_000);
const reply = gotB ? state.responses[before] : undefined;
const latencyMs = reply ? reply.at - sentAt : undefined;
log(`phase B: user_message triggered reply: ${gotB ? 'yes' : 'no'}${gotB ? ` in ${latencyMs} ms` : ''}`);

// Step 4: close and judge. Capture any server close before we close ourselves.
const serverClose = closeInfo();
if (ws.readyState === WebSocket.OPEN) ws.close(1000, 'spike done');
await waitFor(() => false, 500);

const result = { phaseA, phaseB: gotB ? 'yes' : 'no', latencyMs, reply: reply?.text };
if (!gotB) verdict({ ...result, fail: `no agent_response within 15 s after user_message${serverClose}` });
if (!MATCH.test(reply.text)) verdict({ ...result, fail: 'reply does not mention the invoice, the cost center or capex' });
verdict(result);
