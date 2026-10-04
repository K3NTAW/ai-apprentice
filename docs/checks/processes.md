# Manual checks: processes slice (a) (T-0212, fix rounds T-0219, T-0225, T-0233), (c) (T-0234) and (d) (T-0235)

Data model, API and the read side: agent cards, header, filter tabs, the agent page tabs, Learn and Teach read the
agent's processes merged with legacy confirmed sessions (agentWorkMaps). Slices b-d wire the debrief, merge and editing.

Before migration 20261004030000_processes is applied:
1. `GET /api/processes` (signed in) answers 503 `{"error":"processes_unavailable","message":"processes not available yet"}`.
   Same for POST, `GET/PATCH/DELETE /api/processes/<id>`, `/api/processes/<id>/versions` and
   `POST /api/processes/backfill`. Never 500.
2. `/api/export?agent_id=<id>` still exports the agent's confirmed capture sessions.

After `supabase db push`:
3. As owner or expert, `POST /api/processes {agent_id, title, workmap}` answers 201 with version 1;
   `GET /api/processes/<id>/versions` lists one 'trained' row.
4. `PATCH /api/processes/<id> {workmap}` answers version 2 and adds an 'edited' row; `{title}` or `{archived}` alone
   keeps the version and adds no row. `{workmap, title, archived}` is one `update_process` call: with a stale
   expected_version nothing changes, title and archive included.
   `PATCH {workmap, expected_version: 1}` sent again answers 409 `process_version_conflict`; the process stays at
   version 2 and no version row is added. `confirmed` in a POST or PATCH body answers 400; the process's confirmed
   always equals the Work Map's confirmed_by_expert.
5. As owner, `PATCH {archived:true}` hides it from `GET /api/processes` (`?archived=1` shows it); `{archived:false}`
   restores it. As expert, both answer 403.
6. As expert, `DELETE /api/processes/<id>` answers 403; as owner 204, and its versions are gone.
   A session linked with source_session_id keeps its row, sessions.process_id is null.
7. As learner, POST and PATCH answer 403; GET works.
8. `/api/export?agent_id=<id>` exports the confirmed, non-archived processes (titled by the process) plus the
   agent's confirmed capture sessions that no process holds (legacy), newest first.
9. As owner, `POST /api/processes/backfill` (optional `{agent_id}`) answers `{created: n}` with one process per
   legacy confirmed session; a second call answers `{created: 0}`. Two calls at the same time create each process
   once (processes_source_session_key, create_process on conflict do nothing). A backfilled process's created_at
   equals its session's started_at, so the agent page order does not change. As expert, 403.
10. In SQL as an authenticated expert: `update public.processes set agent_id = ...`, `set workmap = ...`,
    `set version = ...`, `set confirmed = ...` and `set archived_at = now()` fail (42501 or permission denied);
    `insert`, `update` and `delete` on process_versions and `insert` on processes are denied for everyone.
    `select public.update_process(id, 1, ...)` with a stale version raises PT409; with
    `'{"task":"t","steps":"x"}'::jsonb` as p_workmap it raises 22023 'invalid workmap' (same for create_process).
    `select public.update_process(id, 1, null, null, null)` raises 22023 'nothing to update'.
11. With a row whose workmap fails WorkMapSchema (inserted as service role), `GET /api/processes` still answers 200
    without it and the server log names the row.
12. On /agents, a card counts the agent's confirmed processes plus its unlinked legacy confirmed sessions; an agent
    whose only ready Work Map is a process shows 'Ready to teach' and is in the Ready filter. The agent page header,
    Processes and Guardrails tabs agree. Learn lists the same Work Maps; Start opens Teach on the process's newest
    linked capture session, and Teach shows the process's current Work Map (titled by the process).
13. `PATCH /api/processes/<id> {}` (or only `expected_version`) answers 400. `PATCH {title, source_session_id}` with a
    session already linked to another process answers 409 `session_linked` and changes nothing; the same session on
    its own process is fine. `POST /api/processes` with such a session answers 409 too.
14. As owner, delete a backfilled process (204): `select * from public.processes_tombstones` lists its source session.
    `POST /api/processes/backfill` again answers `{created: 0}`, the process stays deleted.

15. Slice (c), end of the debrief. Confirm the teach-back for an agent without processes: the session becomes the
    agent's first process ('Saved in ... version 1'). Debrief a second session of the same task: 'This looks like
    <Process> (n% similar)' with Add to it as the default. Add to it shows what changes and the conflicts; Confirm and
    add bumps the version; the old reasons and guardrails are still there, conflicts are open questions.
    `GET /api/processes/<id>/versions` lists 'extended' with the session as source. Replace it on a third session
    keeps the previous version in the history ('replaced'). Save as a new process makes a second process.
16. Edit a step title of a process (PATCH workmap), then open it from Learn: the link carries `&process=<id>` and
    Teach shows the edited title. An old `/teach?session=<id>` link still opens that session's Work Map.
17. Before the migration: the debrief shows no process choice (503) and the session stays a legacy Work Map.
18. Slice (d), Processes tab: each process row has Edit, Add to this process, Retrain from scratch and, as owner,
    Archive and Delete (both ask first). As expert, no Archive or Delete; as learner, only Details. Legacy session rows
    have no actions.
19. /processes/<id> as owner or expert: Rename changes the title without a new version. Edit a step's title, decision
    or reason and Save step: version +1 ('Edited' in the history). A changed reason or guardrail quote shows
    'edited by <your name>'; the version before keeps the original quote (`GET /api/processes/<id>/versions`).
20. Move up / Move down and Delete step (asks first) renumber the steps; a shortcut of a deleted step loses its step.
    Add, edit and delete a guardrail; each saves a new version.
21. Restore on an older version (asks first) makes it the current Work Map as a new version; the history only grows.
    Two tabs editing the same version: the second save says the process changed meanwhile (409), nothing is lost.
22. As owner, Archive (asks first) hides the process from the agent page and Learn; its page shows Archived and
    Restore. Delete process (asks first) goes back to the agent page; the process and its versions are gone.
23. Add to this process opens `/capture?agent=<a>&process=<id>&mode=extend`; at the end of that debrief the Work
    Map is added to the process without the choice ('extended' in the history). Retrain from scratch (`mode=replace`)
    replaces it ('replaced', the old version kept).
24. Before the migration, /processes/<id> says 'Processes are not available yet.'

Rollback: supabase/rollbacks/20261004030000_processes.down.sql (lossy: drops processes, versions and sessions.process_id),
then `supabase migration repair --status reverted 20261004030000`.

# Manual checks: processes slice (b), empty runs (T-0213)

Rule (src/lib/capture/empty.ts): an ended capture is empty when it lasted under 30 s, or has fewer than 3 screen
events and no answered question. A Work Map with steps or a link to a process keeps it. The mark is derived, not
stored, so older runs (no events, no Work Map, or a Work Map without steps) read as empty too: the one-time cleanup.

1. Start a capture and end it within 30 s. The page goes to the debrief, which shows 'No work recorded' with Delete
   and no 'Start debrief'. The sidebar lists the run as 'No work recorded'. No process appears on the agent page.
2. `POST /api/workmap {session_id}` for that run answers 409 `empty_session`; the session still has no Work Map.
3. Delete on the debrief page answers 204 and returns to the agent page; the run is gone from the sidebar.
   `DELETE /api/session/<id>` for a run with work answers 409 `not_empty` and keeps it; as a non-creator expert, 403.
4. A capture of a minute with 2 events and one answered question is not empty: Start debrief shows as before.
5. With an empty run that ended 24 h ago or more, `GET /api/cron/retention` with the CRON_SECRET bearer answers
   `empty_purged: n` (n >= 1) and the run, its rows and frames are gone. A run that ended under 24 h ago stays.
6. One-time cleanup: the existing 'unspecified task' run (no events) shows as 'No work recorded' and the next cron
   run purges it. If it was already backfilled into a process, delete that process as owner (slice a, check 6).

## Fix round (T-0242)

7. Supabase mode: the old 'unspecified task' run (Work Map with `steps: []`) shows as 'No work recorded' in the
   sidebar, with Delete for its creator or an owner. Delete asks first, then the entry is gone. A learner or another
   expert sees no Delete.
8. The agent's Processes list (and export, stats, Learn) never shows a Work Map without steps: the 'unspecified
   task' entry is gone, whether it was a legacy session or a backfilled process. Backfill skips such sessions.
9. The purge reads sessions with plain filters (kind capture, ended 24 h ago or more) and applies the same rule in
   code; it works before the processes migration too (no `process_id` column).
10. `GET /api/cron/retention` runs retention and the purge independently: if one fails the answer is 502 with
    `error` or `empty_error` for it and the other's result (`deleted`, `empty_purged`) still in the body.
