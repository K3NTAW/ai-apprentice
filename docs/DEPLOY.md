# Deploy to Vercel

Human steps, in order. Never paste real keys into the repo, docs or issues; they live only in Supabase and Vercel.

The app needs Node.js runtime functions (every API route sets `runtime = "nodejs"`). The vision, workmap,
decide and workmap/confirm routes set `maxDuration = 60`, which fits the Vercel plan limit of 60 s.
In production without the three Supabase variables the app runs in 'misconfigured' mode: pages show a
setup notice and API routes answer 503 `{"error":"supabase_not_configured"}`. It never falls back to the
local file store or to no auth.

## 1. Create the Supabase project

Either:

- Create a project at https://supabase.com/dashboard (region close to Zurich, e.g. Frankfurt), or
- In Vercel, add Supabase from the Marketplace (Storage tab, Supabase). This creates the project and sets
  NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY on the Vercel
  project for you. If you take this path, do step 4 (import the repo) first so there is a project to attach to.

## 2. Apply the database migrations

The schema, RLS policies and the private `frames` Storage bucket are in `supabase/migrations/`.

- With the CLI: `supabase login`, `supabase link --project-ref <project-ref>`, then `supabase db push`.
- Without the CLI: open the SQL editor in the Supabase dashboard and run each file in
  `supabase/migrations/` in filename order.

## 3. Auth settings

Supabase dashboard, Authentication:

- URL Configuration, Site URL: `https://<domain>`
- URL Configuration, Redirect URLs: add `https://<domain>/auth/callback`
  (add the Preview URL pattern too if you log in on preview deployments, e.g. `https://*-<team>.vercel.app/auth/callback`)
- Sign In / Providers, Email: enabled, magic link on.

`<domain>` is the production domain on Vercel (custom domain or `<project>.vercel.app`).

## 4. Import the GitHub repo into Vercel

Vercel dashboard, Add New, Project, import the GitHub repo. Framework preset Next.js, default build
command (`npm run build`) and output. Do not deploy until step 5 is done (or redeploy after it).

## 5. Environment variables

Vercel project, Settings, Environment Variables. Set each for **Production** and **Preview**:

| Name | Notes |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL (set already if you used the Marketplace) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key (same) |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key, server only (same) |
| ELEVENLABS_API_KEY | ElevenLabs API key |
| ELEVENLABS_AGENT_ID_INTERVIEWER | ElevenLabs agent id for capture interviews, see docs/VOICE_SETUP.md |
| ELEVENLABS_AGENT_ID_TUTOR | ElevenLabs agent id for teach sessions |
| ANTHROPIC_API_KEY | Anthropic API key (vision, Work Map synthesis) |
| JEV_API_KEY | JEV API key |
| DECIDE_PROVIDER | optional, forces the decide provider: jev, llm or heuristic |
| VISION_MODEL | optional, overrides the vision model |

NEXT_PUBLIC_* values are inlined at build time, so redeploy after changing them.

## 6. Deploy and first login

Deploy (or redeploy) from Vercel. Open `https://<domain>/login`, enter your email and follow the magic
link. The first login creates your workspace and makes you its owner.

## 7. Invite a colleague

Signed in as owner, open `/workspace`, enter the colleague's email, pick the role (expert or learner)
and send the invite. The colleague logs in at `https://<domain>/login` with that email; on first login the
pending invite is accepted and they join your workspace.

## 8. Roll back

Vercel dashboard, Deployments: pick the last good production deployment, open its menu and choose
Instant Rollback (or Promote to Production). This switches traffic immediately without a rebuild.
Database migrations are not rolled back by this; a schema change needs its own reverse migration.

## 9. Daily usage caps

Each workspace has a daily cap per paid call, counted in the `usage_counters` table and reset at
midnight Europe/Zurich. Over the cap the route answers 429 `{error: "daily_limit", kind}`; Capture,
Debrief and Teach show a notice and keep running in text mode where they can. Optional, defaults shown:

| Variable | Default | Counts |
| --- | --- | --- |
| USAGE_CAP_VISION | 3000 | one per frame sent to /api/vision |
| USAGE_CAP_DECIDE | 2000 | one per /api/decide call |
| USAGE_CAP_WORKMAP | 50 | one per Work Map synthesis (/api/workmap; confirm is free) |
| USAGE_CAP_VOICE | 60 | one per voice session start (/api/voice/signed-url) |
