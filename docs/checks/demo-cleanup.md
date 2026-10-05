# Demo residue cleanup (P0-12, T-0289)

Checks for a production deploy after the demo residue is removed.

## Preview, fixture and __audit routes answer 404 in production

`fixturesEnabled()` (src/lib/fixtures/enabled.ts) is true only when appMode is local and NODE_ENV is not
production. Every preview page calls `notFound()` when it is false. `src/app/__audit` is a private folder with no
page, so it is never routed. Guard: src/app/fixtures.guard.test.ts.

On the production URL, each of these must answer 404:

- [ ] /login/preview
- [ ] /agents/preview
- [ ] /agents/preview/pip
- [ ] /agents/new/preview
- [ ] /learn/preview
- [ ] /teach/preview
- [ ] /capture/preview
- [ ] /debrief/preview
- [ ] /map/preview
- [ ] /processes/preview
- [ ] /workspace/preview
- [ ] /preview/shell
- [ ] /__audit

```
for p in /login/preview /agents/preview /agents/preview/pip /agents/new/preview /learn/preview /teach/preview \
  /capture/preview /debrief/preview /map/preview /processes/preview /workspace/preview /preview/shell /__audit; do
  printf '%s %s\n' "$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p")" "$p"
done
```

## Capture without a name asks for one

- [ ] Open /capture with no agent (or an agent without an expert name): the Expert field is empty and focused,
      "Who is the expert?" shows next to it, Start is disabled.
- [ ] Type a name: the prompt goes away, Start is enabled.
- [ ] Open /capture?agent=<id> for an agent with an expert name: the field is prefilled with it.
- [ ] No session is created with a name nobody typed (there is no fallback name).

## Usage caps

The intended per-workspace daily caps are the code defaults, `DEFAULT_CAPS` in src/lib/usage/index.ts. A
`USAGE_CAP_*` env var overrides its default.

| Env var           | Default (per workspace per day) |
| ----------------- | ------------------------------- |
| USAGE_CAP_VISION  | 3000                            |
| USAGE_CAP_DECIDE  | 2000                            |
| USAGE_CAP_WORKMAP | 50                              |
| USAGE_CAP_VOICE   | 60                              |

Note: the Vercel production env still carries the raised demo values. A human resets them (remove the
`USAGE_CAP_*` overrides or set them to the defaults above, then redeploy). Tracked as P0-6.

- [ ] Vercel production env: no `USAGE_CAP_*` above the defaults.
