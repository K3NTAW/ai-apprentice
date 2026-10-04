// Spike c: one screen frame -> ScreenEvent JSON via the Anthropic Messages API.
// Usage: node spikes/c-vision.mjs [path-to-image]
// Throwaway. Node built-ins only. Never prints key values.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const envFile = process.env.SPIKE_ENV_FILE || path.join(here, '..', '.env.local');
if (existsSync(envFile)) process.loadEnvFile(envFile);

const EVENT_TYPES = ['record_opened', 'field_changed', 'button_clicked', 'status_changed'];
const MEDIA_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

const SCHEMA = {
  type: 'object',
  properties: {
    events: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: EVENT_TYPES },
          entity: {
            type: 'object',
            properties: { kind: { type: 'string' }, id: { type: 'string' } },
            required: ['kind', 'id'],
            additionalProperties: false,
          },
          field: { type: 'string' },
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['type', 'entity'],
        additionalProperties: false,
      },
    },
  },
  required: ['events'],
  additionalProperties: false,
};

const SYSTEM =
  'You watch an accounts-payable ERP screen. Report what is visible as events. ' +
  'Do not invent values: only use ids, field names and values that are readable on the screen.';

function fail(msg) {
  console.log(`FAIL: ${msg}`);
  process.exit(1);
}

function validate(parsed) {
  const problems = [];
  if (!parsed || !Array.isArray(parsed.events)) return ['events is not an array'];
  parsed.events.forEach((e, i) => {
    if (!EVENT_TYPES.includes(String(e?.type).toLowerCase())) problems.push(`events[${i}].type "${e?.type}" not in enum`);
    if (typeof e?.entity?.kind !== 'string') problems.push(`events[${i}].entity.kind not a string`);
    if (typeof e?.entity?.id !== 'string') problems.push(`events[${i}].entity.id not a string`);
  });
  return problems;
}

if (!process.env.ANTHROPIC_API_KEY) {
  console.log('SKIP: ANTHROPIC_API_KEY not set in .env.local');
  process.exit(2);
}

let imagePath = process.argv[2];
if (!imagePath) {
  imagePath = ['invoice-frame.png', 'invoice-frame.jpg']
    .map((f) => path.join(here, 'fixtures', f))
    .find((p) => existsSync(p));
  if (!imagePath) fail('no default fixture found; pass an image path');
}
if (!existsSync(imagePath)) fail(`image not found: ${imagePath}`);
const media_type = MEDIA_TYPES[path.extname(imagePath).toLowerCase()];
if (!media_type) fail(`unsupported image extension: ${path.extname(imagePath)}`);

const model = process.env.VISION_MODEL || 'claude-haiku-4-5-20251001';
const body = {
  model,
  max_tokens: 1024,
  system: SYSTEM,
  messages: [
    {
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type, data: readFileSync(imagePath).toString('base64') } },
        { type: 'text', text: 'This is the current frame. List the events visible on it.' },
      ],
    },
  ],
  output_config: { format: { type: 'json_schema', schema: SCHEMA } },
};

try {
  const t0 = performance.now();
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });
  const ms = Math.round(performance.now() - t0);
  const text = await res.text();
  if (!res.ok) fail(`HTTP ${res.status}: ${text.slice(0, 500)}`);
  const data = JSON.parse(text);
  if (data.stop_reason === 'refusal') fail('model refused');
  const out = data.content?.find((b) => b.type === 'text')?.text;
  if (!out) fail(`no text block (stop_reason ${data.stop_reason})`);
  let parsed;
  try {
    parsed = JSON.parse(out);
  } catch {
    fail(`reply is not JSON (stop_reason ${data.stop_reason}): ${out.slice(0, 200)}`);
  }
  console.log('model:', model, 'image:', path.relative(process.cwd(), imagePath));
  console.log('events:', JSON.stringify(parsed.events, null, 2));
  console.log(`latency_ms: ${ms}`);
  console.log(`input_tokens: ${data.usage?.input_tokens} output_tokens: ${data.usage?.output_tokens}`);
  const problems = validate(parsed);
  if (problems.length) fail(problems.join('; '));
  if (parsed.events.length === 0) fail('events array is empty');
  console.log(`PASS: ${parsed.events.length} valid event(s)`);
} catch (err) {
  fail(err?.name === 'TimeoutError' ? 'request timed out' : String(err?.message ?? err));
}
