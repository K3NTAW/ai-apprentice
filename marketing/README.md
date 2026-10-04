# AI Apprentice marketing site

The public website: landing (Main, LandingLight, LandingPhone in docs/design/canvas), Download, Privacy and
Imprint. Its own Next.js project (App Router, TypeScript, Tailwind), separate from the app at the repo root.
The design tokens, ui components and fonts are copies of the app's (`app/globals.css`, `components/ui`,
`components/agents/AgentAvatar.tsx`, `lib/avatar/render.ts`); nothing is imported from `../src`. When the app's
tokens change, copy them over again.

## Local

```sh
npm ci
npm run dev        # http://localhost:3100
npm test           # Vitest: landing render, download page logic
npm run build
```

From the repo root: `npm run marketing:dev` / `npm run marketing:build`.

## Env (all public, inlined at build time; no secrets)

| Variable | Used for |
| --- | --- |
| `NEXT_PUBLIC_APP_URL` | 'Sign in' (`<app>/login`) and 'Open the app'. Unset: no 'Sign in', the CTA is the download page. |
| `NEXT_PUBLIC_DOWNLOAD_MAC_ARM64` | macOS, Apple silicon build. Unset: 'Coming soon'. |
| `NEXT_PUBLIC_DOWNLOAD_MAC_X64` | macOS, Intel build. Unset: 'Coming soon'. |
| `NEXT_PUBLIC_DOWNLOAD_WIN` | Windows build. Unset: 'Coming soon'. |

Values must be http(s) URLs; anything else counts as unset.

## Deploy as a separate Vercel project

1. Vercel, Add New, Project, import this repository a second time (the app is the first project).
2. Root Directory: `marketing`. Framework preset: Next.js. Install, build and output settings: defaults.
3. Environment Variables: the four above (Production, and Preview if wanted).
4. Deploy. Add the marketing domain (e.g. `www.<domain>`) under Domains.
5. In the app project, set `NEXT_PUBLIC_MARKETING_URL` to this site's URL so the login screen links here.

Changing an env var needs a redeploy (they are inlined at build time). Full steps: docs/DEPLOY.md.
