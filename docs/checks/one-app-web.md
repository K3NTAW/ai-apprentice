# Manual checks: one-app-web (T-0120)

Web app inside the desktop app (bridge transport, code login) and the browser fallback.

1. Desktop app, signed out: the login page shows 'Email me a code'. The email contains a code; entering it lands on
   /agents (or the ?next path). A wrong code shows 'That code is not right', an old one 'expired or was already used'.
2. Desktop app, /capture: no pairing card; 'Running in AI Apprentice' shows, with missing permissions if any.
   No 'Get the desktop app' panel flashes on load. The sidebar has no 'Get the desktop app' link.
3. Desktop app, Capture Start: the screen share starts without a picker, then the window steps aside.
   End task restores the window. Stopping the share, or a refused share, also restores it (nothing steps aside
   when the share fails).
4. Desktop app, Teach Start and Finish: same as 3. Leaving the page during a session restores the window.
5. Desktop app: chords, activity and app events reach Capture and Teach only while a session runs.
   Check that getDisplayMedia after the awaited session create is still answered by the app's handler (no
   transient user activation needed); if not, the share stays a button click.
6. Plain browser, /capture and /teach: the 'Get the desktop app' panel shows (anchor /capture#companion), with
   macOS/Windows links only when NEXT_PUBLIC_DESKTOP_DOWNLOAD_MAC / _WIN are set. Agents, Work Maps, workspace and
   learn work as before. The Dashboard 'Install the desktop companion' link (Dashboard.tsx, outside this task's
   scope) still lands on that panel.
7. Plain browser with localStorage `ai-apprentice.companion.ws` = `1`: the old pairing card returns.
8. Plain browser login: 'Send sign-in link' works; the code from the same email also signs in.
