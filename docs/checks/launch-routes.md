# Launch D: route checks (launch-routes)

Every handler under src/app/api starts with requireContext(): signed out 401 `{"error":"unauthorized"}`,
misconfigured 503 `{"error":"supabase_not_configured"}`, no workspace 403 `{"error":"no_workspace"}`.
Store calls go through getStore(ctx), scoped to the active workspace.

## Roles

- POST /api/session kind `capture`: owner or expert (learner 403). Kind `teach`: any member. Answers 201.
- Reads (list, GET session, frames, export): any member of the active workspace, learners included for capture sessions.
- Writes on a session (events, transcript, qa, off-record, vision, end, workmap, workmap/confirm): the session creator or an owner, else 403.
- A session id from another workspace answers 404 with the same body as a missing id, never 403.

## Setup

Deployed app with Supabase env set. Two users: A in workspace WA, B in workspace WB only.
Sign in as A in a browser, copy the `sb-*-auth-token` cookies into `$COOKIE_A`. Do the same for B.
Create a session as B and note its id as `$SID_B`.

```sh
BASE=https://<deployment>
```

## 401 without a cookie

```sh
for p in /api/session /api/session/$SID_B /api/export?session_id=$SID_B "/api/voice/signed-url?role=tutor"; do
  curl -s -o /dev/null -w "%{http_code} GET $p\n" "$BASE$p"
done
for p in /api/session /api/session/$SID_B/events /api/session/$SID_B/end /api/vision /api/workmap /api/workmap/confirm /api/decide /api/redact; do
  curl -s -o /dev/null -w "%{http_code} POST $p\n" -X POST -H 'content-type: application/json' -d '{}' "$BASE$p"
done
```

Expect 401 on every line.

## 404 across workspaces

```sh
curl -s -w " %{http_code}\n" -H "cookie: $COOKIE_A" "$BASE/api/session/$SID_B"
curl -s -w " %{http_code}\n" -H "cookie: $COOKIE_A" "$BASE/api/session/does_not_exist"
curl -s -w " %{http_code}\n" -H "cookie: $COOKIE_A" "$BASE/api/session/$SID_B/frames/0001.jpg"
curl -s -w " %{http_code}\n" -H "cookie: $COOKIE_A" -X POST -H 'content-type: application/json' \
  -d "{\"session_id\":\"$SID_B\",\"confirmed\":true}" "$BASE/api/workmap/confirm"
curl -s -w " %{http_code}\n" -H "cookie: $COOKIE_A" -X POST -H 'content-type: application/json' \
  -d '{"events":[]}' "$BASE/api/session/$SID_B/events"
```

Expect 404 on every line, and the body for `$SID_B` equal to the body for `does_not_exist` apart from the id.
As B the same requests answer 200 (confirm answers 409 until a Work Map exists).

## Frames

As B: `curl -sI -H "cookie: $COOKIE_B" "$BASE/api/session/$SID_B/frames/0001.jpg"` shows
`cache-control: private, no-store`.

## Rollback

Reversible per commit. The top-level file-store wrappers in src/lib/store/index.ts are removed in a separate
commit, so reverting it restores them. Do not change the 'frames' bucket path layout
(`<workspaceId>/<sessionId>/<name>`): Storage RLS and session_frames.storage_path depend on it.
