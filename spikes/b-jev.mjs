// Spike b: one Jev decide() call (or the LLM JSON fallback) for a single event.
// Usage: node spikes/b-jev.mjs [--fallback]
// Throwaway. Node built-ins only. Never prints key values.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.SPIKE_ENV_FILE || path.join(here, '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const STATE =
  'cost center of invoice 4471 (hydraulic press, EUR 7,400) changed from 4711 (opex) to 0400 (capex); ' +
  'expert has been silent for 3 seconds';

const QUESTIONS = {
  event_class: {
    type: 'choice',
    instructions: 'Classify this ERP event from the point of view of an apprentice watching an accounts-payable expert.',
    criteria: {
      routine: 'Ordinary data entry, nothing to learn or ask about.',
      judgment_call: 'The expert made a decision that reflects tacit knowledge worth capturing.',
      possible_guardrail: 'The change could violate a policy or control and may need a rule.',
    },
  },
  screen_explains_it: {
    type: 'noul',
    instructions: 'Is the reason for this change fully explained by what is visible on the screen?',
  },
  ask_timing: {
    type: 'choice',
    instructions: 'When should the apprentice ask the expert about this event?',
    criteria: {
      ask_now: 'Ask immediately; the expert is paused and context is fresh.',
      wait: 'Wait; the expert is mid-task and a question would interrupt.',
      save_for_debrief: 'Not urgent; save it for the end-of-session debrief.',
    },
  },
};

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

async function post(url, headers, body, { timeoutMs, retryOn = [] }) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (attempt === 0 && retryOn.includes(res.status)) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    const text = await res.text();
    if (!res.ok) fail(`HTTP ${res.status}: ${text.slice(0, 500)}`);
    try {
      return JSON.parse(text);
    } catch {
      fail(`response is not JSON: ${text.slice(0, 200)}`);
    }
  }
}

async function runJev() {
  const body = { state: STATE, model: 'jev-latest', questions: QUESTIONS };
  const t0 = performance.now();
  const data = await post(
    'https://api.typesafe.ai/v1/systemone',
    { Authorization: `Bearer ${process.env.JEV_API_KEY}`, 'Content-Type': 'application/json' },
    body,
    { timeoutMs: 5000, retryOn: [429, 529] },
  );
  const ms = Math.round(performance.now() - t0);
  const a = data?.answers ?? {};
  console.log('answers:', JSON.stringify(a, null, 2));
  console.log('usage:', JSON.stringify(data?.usage ?? null));
  console.log(`latency_ms: ${ms}`);

  const problems = [];
  for (const key of ['event_class', 'ask_timing']) {
    const ans = a[key];
    const options = Object.keys(QUESTIONS[key].criteria);
    if (!ans || !options.includes(ans.choice)) problems.push(`${key}.choice missing or not an option`);
    if (!ans?.probabilities || typeof ans.probabilities !== 'object') problems.push(`${key}.probabilities missing`);
    console.log(`observed ${key}: confidence ${ans && 'confidence' in ans ? `present (${ans.confidence})` : 'missing'}`);
  }
  const noul = a.screen_explains_it?.noul;
  if (typeof noul !== 'number') problems.push('screen_explains_it.noul is not a number');
  else console.log(`observed screen_explains_it.noul: ${noul} (in [0,1]: ${noul >= 0 && noul <= 1})`);

  if (problems.length) fail(problems.join('; '));
  console.log('PASS: jev answered all three questions with the expected fields');
}

// Fallback: same three questions through the Anthropic Messages API with a JSON schema.
const choice = (options) => ({
  type: 'object',
  properties: {
    choice: { type: 'string', enum: options },
    confidence: { type: 'number' },
  },
  required: ['choice', 'confidence'],
  additionalProperties: false,
});

const FALLBACK_SCHEMA = {
  type: 'object',
  properties: {
    event_class: choice(Object.keys(QUESTIONS.event_class.criteria)),
    screen_explains_it: {
      type: 'object',
      properties: { noul: { type: 'number' } },
      required: ['noul'],
      additionalProperties: false,
    },
    ask_timing: choice(Object.keys(QUESTIONS.ask_timing.criteria)),
  },
  required: ['event_class', 'screen_explains_it', 'ask_timing'],
  additionalProperties: false,
};

async function runFallback() {
  const model = process.env.DECIDE_MODEL || 'claude-haiku-4-5-20251001';
  const prompt =
    `State: ${STATE}\n\nAnswer each question.\n` +
    `Choice questions: pick one option and give a confidence between 0 and 1. ` +
    `Yes/no questions (noul): give the probability of yes between 0 and 1.\n\n` +
    `Questions:\n${JSON.stringify(QUESTIONS, null, 2)}`;
  const body = {
    model,
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }],
    output_config: { format: { type: 'json_schema', schema: FALLBACK_SCHEMA } },
  };
  const t0 = performance.now();
  const data = await post(
    'https://api.anthropic.com/v1/messages',
    {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body,
    { timeoutMs: 30000 },
  );
  const ms = Math.round(performance.now() - t0);
  if (data.stop_reason === 'refusal') fail('model refused');
  const text = data.content?.find((b) => b.type === 'text')?.text;
  if (!text) fail(`no text block (stop_reason ${data.stop_reason})`);
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail(`reply is not JSON: ${text.slice(0, 200)}`);
  }
  console.log('model:', model);
  console.log('answers:', JSON.stringify(parsed, null, 2));
  console.log(`latency_ms: ${ms}`);
  console.log(`input_tokens: ${data.usage?.input_tokens} output_tokens: ${data.usage?.output_tokens}`);
  if (!parsed.event_class?.choice || !parsed.ask_timing?.choice || typeof parsed.screen_explains_it?.noul !== 'number') {
    fail('fallback answers missing expected fields');
  }
  console.log('PASS (fallback): all three questions answered');
}

const wantFallback = process.argv.includes('--fallback');
try {
  if (!wantFallback && process.env.JEV_API_KEY) await runJev();
  else if (process.env.ANTHROPIC_API_KEY) await runFallback();
  else {
    console.log(`SKIP: ${wantFallback ? 'ANTHROPIC_API_KEY' : 'JEV_API_KEY'} not set in .env.local`);
    process.exit(2);
  }
} catch (err) {
  fail(err?.name === 'TimeoutError' ? 'request timed out' : String(err?.message ?? err));
}
