# AI Apprentice

Next.js (App Router) + TypeScript + Tailwind app. See docs/BUILD_SPEC.md for the spec.

## Setup

```sh
cp .env.example .env.local
npm install
npm run dev
npm test
```

Merge gate: `bash .orchestrator/tests.sh` (vitest, tsc, eslint).

## Deploy

Vercel + Supabase. Step-by-step human setup (Supabase project, migrations, Auth, env vars, invites, rollback): [docs/DEPLOY.md](docs/DEPLOY.md).
