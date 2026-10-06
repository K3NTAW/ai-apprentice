# Manual checks: capture scope (T-0311, T-0336)

Window-first capture: the browser picker opens on windows, the share reports its surface, and the macOS companion uses the system picker.

The vision route stores a screen frame only for key moments. This page states the rule, how it fails, how to spot a failure in the logs, and how to check it by hand.

## Capture surface

Chrome (`/teach`, browser, no desktop app):

1. Start, then Share screen: the picker opens on the Window tab, this tab is not offered, and Entire screen is still selectable.
2. Pick a window: teach shows the monitor warning ("You shared a window or tab, not the whole screen ..."), no halo appears.
3. Stop sharing, share again and pick Entire screen: no warning, halos land on the right place on the primary display.
4. Use Chrome's "Share this tab instead" / switch-surface control while sharing: the share keeps running.

macOS companion (desktop app):

1. Start a teach session: the macOS system picker appears (not the silent primary-screen grant).
2. Pick a window: the window steps aside, teach shows the monitor warning, no halo.
3. Finish, start again and pick a screen: no warning, halos work.

Rollback: launch the companion with `APPRENTICE_SYSTEM_PICKER=0` to restore the old behaviour (no system picker, the handler answers with the primary screen). The browser request change is reverted by reverting the T-0311 commit.

## Storage rule

- A frame is stored only when at least one event in the model reply has importance "key".
- Zero-event, all-routine and all-unrated replies are never stored.
- Off-record is checked before the model call, and again after it for replies without a key event.
- One frame_ref per batch. When nothing is stored, the response has no frame_ref key (not null, absent).

## Fail direction

When importance is missing from the model reply (a prompt or schema regression), the route falls back silently to "nothing stored". The response is still 200 and the warn log line below is the only signal.

This is data loss. It lasts until STORE_ALL_FRAMES=1 is set plus a redeploy. Frames not stored in the meantime cannot be recovered.

## Log line vision.frame

One `vision.frame` line per decided frame. Fields:

- `key`, `routine`, `unrated`: event counts by importance
- `stored`: true or false
- `model`: "called", "no_api_key" or "not_called"
- `error` (optional): "check_failed" or "save_failed"

Level is warn when model is "no_api_key", when error is set, or when events exist and all are unrated. Level is info otherwise. The line never carries event text.

Log query for the regression signal: event `vision.frame`, level `warn`, `key` 0, `routine` 0, `unrated` above 0. Run it in Vercel runtime logs, or on the JSON log stream per docs/OBSERVABILITY.md, e.g.

```
vercel logs <deployment-url> --json | jq -r '.message' | jq -c 'select(.event == "vision.frame" and .level == "warn" and .key == 0 and .routine == 0 and .unrated > 0)'
```

Owner until an alert exists: the human operator. There is no automated alert in Phase 0 (Sentry org pending, see docs/OBSERVABILITY.md). The cost meter task adds a counter later.

## Steps without a frame

A synthesized step can have no frame: src/lib/workmap/synthesize.ts handles a missing frame_ref.

The second off-record check is best effort. A frame can still reach the model if off-record starts after the first check; nothing from it is stored.

## STORE_ALL_FRAMES

- STORE_ALL_FRAMES=1 restores storing every frame before the model call. This is the rollback.
- On Vercel, set the variable and redeploy.
- Unset or any other value means key-only.

## Manual check

On a local file store, with one key frame and one routine frame:

1. Post the key frame. Expect `frame_ref` in the response and an info `vision.frame` line with `stored` true.
2. Post the routine frame. Expect no `frame_ref` key in the response and `stored` false.
3. Run the log query above. It returns nothing.

Note: README.md, docs/DEPLOY.md, .env.example (docs sync task) and docs/legal/privacy-policy.md (follow-up task) are updated separately.
