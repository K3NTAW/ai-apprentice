# Manual checks: one-app-desktop (T-0121)

Run on a packaged build (`npm --prefix companion run package`) on macOS, and where noted on Windows.

## Install and first run
- [ ] Open `AI Apprentice.app` (after `xattr -dr com.apple.quarantine`). Window title, Dock name, tray tooltip and About say `AI Apprentice`.
- [ ] The main window opens about 1280x820 on the control room URL from `app.config.json`. Resize and move it, quit, reopen: size and position are kept.
- [ ] Unplug the external display the window was on, reopen: the window opens on the main display at the default size.
- [ ] Launch the app a second time: no second instance, the first window comes forward.
- [ ] Close the window: it hides, the Dock icon goes away, the tray stays. `Open AI Apprentice` in the tray brings it back. Cmd+Q quits.
- [ ] `APP_URL=http://example.com` on launch: error page, no page loaded.

## Login flow
- [ ] Sign in with the email one-time code inside the window. The session survives a quit and relaunch.
- [ ] A magic link or OAuth button opens in the system browser, not in the app window (expected until the web side offers code entry).
- [ ] Sign out and sign in again: `window.apprentice` is present on the control room after login.

## Bridge
- [ ] DevTools (dev build) on the control room: `window.apprentice.version` is set. Navigate the window to another origin via a link: the link opens in the system browser instead.
- [ ] No pairing code in the tray or panel by default. With `COMPANION_WS=1` the pairing code and WebSocket flow work as before.
- [ ] Reload the page during a Capture: dock and buddy clear, status arrives again after the reload.

## Capture and permissions
- [ ] Start training: the window steps aside (minimises), the dock appears, chords and activity reach the page. End the task: the window comes back.
- [ ] Start training with the window in fullscreen: it leaves fullscreen and minimises; ending restores it.
- [ ] Screen capture starts with no picker. Captured frames do not show the dock, buddy, halo or panel.
- [ ] Display capture keeps delivering frames while the main window is minimised (backgroundThrottling off).
- [ ] Screen Recording denied (`tccutil reset ScreenCapture app.aiapprentice.companion`, then deny): capture fails visibly in the page; the app does not crash; the tray shows `Grant Screen Recording…`.
- [ ] Microphone: the first push-to-talk asks for the microphone with the app's usage text; the camera is never requested.

## Windows
- [ ] `npm run package:win` installer installs `AI Apprentice`; left click on the tray opens the main window; capture works without a picker.
