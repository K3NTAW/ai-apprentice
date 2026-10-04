# Manual checks: agents-model (T-0105, agents wave A1)

Run against a Supabase project (Postgres 15 or later: the foreign key uses `on delete set null (agent_id)`).

## Migration and rollback

1. `supabase db push` applies `20261004000000_agents.sql` without errors.
2. As an owner and as an expert: insert an agent with `created_by = auth.uid()` succeeds. As a learner: 42501.
   With `created_by` set to another user: 42501.
3. As an owner: update an agent's name; `updated_at` moves forward, `created_at` stays.
   Changing `id`, `workspace_id`, `created_by` or `created_at`: 42501.
4. As an expert: delete an agent affects 0 rows. As an owner: the agent is deleted.
5. Insert a session with an `agent_id` of another workspace: 23503 (sessions_agent_fkey).
6. Update a session's `agent_id` from null to an agent, or to another agent: 42501. Setting it to null works.
7. Delete an agent that has sessions: the sessions stay, their `agent_id` is null.
8. Run `supabase/rollbacks/20261004000000_agents.down.sql` twice: both runs succeed. `public.agents` and
   `sessions.agent_id` are gone; `sessions_guard_update` is the init version again. The downgrade is lossy:
   agents and session links are deleted.

## Rules, as built

- agents RLS: select for members; insert for owner or expert with `created_by = auth.uid()`; update for owner
  or expert (with check equals using); delete for owner. Every policy is `to authenticated`.
- `sessions.agent_id`: set at insert only. Afterwards it may only change to null (agent deleted or detached).
- Agent delete: sessions keep their history with `agent_id` null; the API answers 204, and 404 when the agent
  is missing or in another workspace.
- API: `/api/agents` GET any member, POST owner or expert; `/api/agents/[id]` GET any member, PATCH owner or
  expert (strict body, avatar replaced as a whole, `expert_name: null` clears it), DELETE owner. Unknown keys
  and an invalid avatar answer 400. `POST /api/session` with an `agent_id` outside the active workspace: 404.
- The `/api/agents` routes call `requireContext` first, so `src/app/api/routes.auth.test.ts` covers them with
  its generic 401, 503 and 403 cases; its route list is unchanged.
- Local mode: agents live in `data/agents.json` (one array, temp file + rename, one write queue). Local mode
  has one `local` workspace and the owner role. Ids are `randomUUID()`, like `gen_random_uuid()` in the DB.
- Stats (`src/lib/agents/stats.ts`): processes = confirmed Work Maps of the agent's capture sessions;
  guardrails = distinct rules across those, deduped by normalised text; learners = distinct non-null creators
  of teach sessions; last_trained = latest ended_at, else started_at, of capture sessions; shortcuts = null
  until the shortcuts task lands.
- The avatar zod schema is `AvatarSchema` in `src/lib/types.ts`, the single source for the app, render.ts and the API.

## Manual

- [ ] Steps 1 to 8 above against a real project.
- [ ] In local mode: create, rename and delete an agent through the API; `data/agents.json` stays valid JSON.
