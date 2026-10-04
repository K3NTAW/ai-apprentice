# Deploy to Vercel

Human steps, in order. Never paste real keys into the repo, docs or issues; they live only in Supabase and Vercel.

## Two Vercel projects from one repo

| Project | Root Directory | What it serves | Env vars |
| --- | --- | --- | --- |
| app | repo root (default) | the product: `/` redirects to `/agents` (signed in) or `/login` (signed out) | steps 5 and the table below |
| marketing | `marketing` | the public site: landing, Download, Privacy, Imprint | section 10 |

Both import the same GitHub repo. Steps 1 to 9 set up the app; section 10 sets up the marketing site. The desktop
app opens the app (APP_URL + `/agents` or `/login`), never the marketing site.

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
- URL Configuration, Redirect URLs: add `https://<domain>/auth/callback` and `https://<domain>/auth/reset`
  (add the Preview URL patterns too if you log in on preview deployments, e.g. `https://*-<team>.vercel.app/auth/callback`
  and `https://*-<team>.vercel.app/auth/reset`). Without the `/auth/reset` entry the password reset link falls back
  to the Site URL and the user cannot set a new password.
- Sign In / Providers, Email: enabled, with password sign-in (email + password is the login in the desktop app and
  in the browser) and magic link (the browser also offers 'Email me a link').
- Sign In / Providers, Email, minimum password length: 8 (the login form and `/auth/reset` require at least 8).
- Sign In / Providers, Email, **Confirm email**:
  - **on** (current setting since 2026-10-04, `auth.email.enable_confirmations = true`; required, otherwise anyone
    could sign up as an invited address and inherit the invite). 'Create account' triggers the default "Confirm your
    signup" message and the form says "Check your inbox and click the confirmation link, then sign in here." with a
    'Resend confirmation' button (`auth.resend` type `signup`). Signing in before confirming ('Email not confirmed')
    shows the same guidance. The link goes to `https://<domain>/auth/callback?flow=signup`; opened outside the app
    it lands on `/auth/confirmed` ("Confirmed. Go back to the AI Apprentice app and sign in."). `/api/auth/bootstrap`
    also refuses (403 `email_not_confirmed`) a session whose address is not confirmed, and `bootstrap_workspace`
    checks `email_confirmed_at` in the database.
- Emails, Templates: no changes. On the free tier with the built-in sender templates cannot be edited; the default
  Magic Link message (link only) and the default Reset Password message both work as they are. 'Forgot password?'
  calls `resetPasswordForEmail` with `redirectTo` `https://<domain>/auth/reset`; the link opens in the browser,
  where the user sets a new password and is told to sign in again in the app.
- `/api/auth/bootstrap` (called after a password sign-in or sign-up, runs the workspace bootstrap) checks the
  session first, then throttles (per server instance, 10 minute window, then 429): signed-in calls count per user
  id (20); calls without a session (the 401s) count per client IP with a looser limit (60). Supabase's own Auth
  rate limits apply too. Client IP assumption: on Vercel the platform sets `x-vercel-forwarded-for` and `x-real-ip`
  and overwrites client-sent values, so those are read first; `x-forwarded-for` is only a fallback off Vercel,
  where a client could spoof it.
- `/auth/reset`: after the new password is saved the user is signed out with scope `global`, so every older
  session (other browsers, the desktop app) is revoked.

`<domain>` is the production domain on Vercel (custom domain or `<project>.vercel.app`).

## 4. Import the GitHub repo into Vercel (the app project)

Vercel dashboard, Add New, Project, import the GitHub repo. Root Directory: the repo root (leave it empty).
Framework preset Next.js, default build command (`npm run build`) and output. Do not deploy until step 5 is done (or redeploy after it).

## 5. Environment variables

Vercel project, Settings, Environment Variables. Set each for **Production** and **Preview**:

| Name | Notes |
| --- | --- |
| NEXT_PUBLIC_SUPABASE_URL | Supabase project URL (set already if you used the Marketplace) |
| NEXT_PUBLIC_SUPABASE_ANON_KEY | Supabase anon key (same) |
| SUPABASE_SERVICE_ROLE_KEY | Supabase service role key, server only (same) |
| FORWARDED_USER_SECRET | optional, server only: HMAC key for the user the proxy forwards to the page render (any long random string, e.g. `openssl rand -base64 32`). Unset, the key is derived from SUPABASE_SERVICE_ROLE_KEY, which is enough on Vercel. With neither, the server logs one warning and every page calls getUser twice |
| ELEVENLABS_API_KEY | ElevenLabs API key |
| ELEVENLABS_AGENT_ID_INTERVIEWER | ElevenLabs agent id for capture interviews, see docs/VOICE_SETUP.md |
| ELEVENLABS_AGENT_ID_TUTOR | ElevenLabs agent id for teach sessions |
| ANTHROPIC_API_KEY | Anthropic API key (vision, Work Map synthesis) |
| JEV_API_KEY | JEV API key |
| DECIDE_PROVIDER | optional, forces the decide provider: jev, llm or heuristic |
| NEXT_PUBLIC_DESKTOP_DOWNLOAD_MAC | optional, https download link for the macOS desktop app ('Get the desktop app' panel; hidden when unset) |
| NEXT_PUBLIC_DESKTOP_DOWNLOAD_WIN | optional, https download link for the Windows desktop app |
| NEXT_PUBLIC_MARKETING_URL | optional, the marketing site URL (section 10, e.g. `https://www.<domain>`). The login screen shows 'What is AI Apprentice?' linking there; hidden when unset |
| NEXT_PUBLIC_COMPANION_WS | optional, `1` turns on the old local WebSocket companion in the browser (default off; per browser: localStorage `ai-apprentice.companion.ws` = `1`) |
| VISION_MODEL | optional, overrides the vision model |
| CRON_SECRET | server only, at least 16 characters (e.g. `openssl rand -base64 32`). Vercel Cron sends it as `Authorization: Bearer <CRON_SECRET>` to /api/cron/retention (vercel.json, daily 03:00 UTC). Unset, the route rejects every call and no screen moments expire |

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
supabase/rollbacks/20261004010000_agent_settings.down.sql drops every stored agent setting, every deletion request
and every deletion report (agents fall back to the default settings).

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

## 10. Marketing site (second Vercel project)

The landing, Download, Privacy and Imprint pages are their own Next.js project in `marketing/` (details in
marketing/README.md). It has no server secrets.

1. Vercel dashboard, Add New, Project, import the same GitHub repo again.
2. Root Directory: `marketing`. Framework preset Next.js; install, build and output: defaults
   (`npm ci`, `npm run build`).
3. Environment Variables, for **Production** and **Preview**:

| Name | Notes |
| --- | --- |
| NEXT_PUBLIC_APP_URL | the app's URL, e.g. `https://<domain>`. 'Sign in' goes to `<app>/login`, 'Open the app' to the app. Unset: no 'Sign in', the CTA is the Download page |
| NEXT_PUBLIC_DOWNLOAD_MAC_ARM64 | https link to the macOS Apple silicon build. Unset: 'Coming soon' |
| NEXT_PUBLIC_DOWNLOAD_MAC_X64 | https link to the macOS Intel build. Unset: 'Coming soon' |
| NEXT_PUBLIC_DOWNLOAD_WIN | https link to the Windows build. Unset: 'Coming soon' |

4. Deploy, then add the marketing domain (e.g. `www.<domain>`) under Domains.
5. In the app project set NEXT_PUBLIC_MARKETING_URL to that domain and redeploy the app.

Download links: build the desktop app (`npm --prefix companion run package` for macOS, `package:win` for Windows),
upload each installer to a public host (e.g. a GitHub Release asset), paste each https link into the matching
variable on the marketing project and redeploy it. A value that is not an http(s) URL counts as unset. The
variables are inlined at build time, so every change needs a redeploy. Local check: `npm run marketing:dev`
(port 3100) and `npm run marketing:build` from the repo root.
