# Manual checks: pivot-capture (T-0084)

Capture on real apps: sandbox ERP removed, whole-screen share, desktop companion pairing, companion activity in the ask gate.

1. `/erp` returns 404 (route deleted, no redirect). Nav and landing page show no ERP link or copy; the landing says "works on the apps you already use".
2. `/capture`: the left side is the session console (Expert, Start, Share screen, Pause / off the record, End task, live events, question counter, last question, Desktop companion card). The voice side panel stays on the right.
3. Share screen in Chrome: the picker preselects "Entire screen". Pick a window instead: an amber warning says halo placement will be off. Stop sharing from Chrome's own bar: the button returns to "Share screen" and frames stop.
4. Companion not running: the card says "Not running or not reachable from this browser"; no console errors, Capture still asks at speech pauses.
5. Companion running, enter the 6-digit tray code: status becomes "Paired"; reload keeps the pairing (code in localStorage for this origin). A wrong code returns to "Pair" and the stored code is cleared. Missing macOS permissions are listed.
6. Paired: typing in Outlook holds a question; it comes once you stop typing. Switching apps adds "switched to <app>" lines to the feed. A window title with an email address shows it redacted.
7. Pause / off the record: switching apps and typing add nothing to the feed; after resuming, app switches show up again.
8. Safari on the https deployment: the companion is blocked (mixed content to ws://127.0.0.1); the card shows the "not reachable from this browser" hint. Chrome may show a Private Network Access prompt the first time; allow it.
9. Kill the companion while paired: status falls to "Not running...", reconnect attempts back off (1 s, 2 s, 4 s ... capped at 30 s) and pairing resumes when it restarts.

Rollback: the work lands as two commits on the task branch (deletions, then new code); revert both to restore the sandbox.
