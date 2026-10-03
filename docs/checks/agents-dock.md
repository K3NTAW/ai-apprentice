# Manual checks: agents-dock (side dock, avatar buddy, chords; protocol v3)

Run on macOS (and Windows 11 x64 where noted) with the web app on `http://localhost:3000`.
`cd companion && npm install && npm run dev`, pair as in `pivot-companion.md` item 4.

Automated: `npm run test:companion` from the repo root (dock view model, avatar URL checks, chord
classifier, protocol v3 parsing). Record OS and build for each run below.

Send from the paired page console. An agent payload needs real avatar data URLs from
`renderAvatarSvg` (web app) or any small SVG: `btoa('<svg xmlns="http://www.w3.org/2000/svg" ...>')`.

1. **Capture shows the dock**: send `session.state` with `mode:"capture"` and an `agent`. The dock
   appears on the right edge of the primary display, about 300 px wide and 60% of its height,
   rounded. Avatar, name, role, counters and the three buttons show. The cursor buddy is gone.
2. **Focus steal**: type in TextEdit or Outlook, then send `buddy.say`, `dock.learned` and
   `buddy.state` changes. Typing never loses focus, the caret stays, the frontmost app does not change.
   Click `Pause` in the dock: the action reaches the page and the typing app keeps focus after
   clicking back. Windows: the same with Notepad.
3. **States**: `buddy.state` idle, listening, thinking, speaking, paused: the dock avatar switches
   frames (speaking shows `talking`).
4. **Feed**: send 10 `dock.learned` lines with mixed kinds: only the last 8 show, with `→`, `⌘`, `⚠`.
   Re-sending an existing line adds nothing. A new `session.state` with another title clears it.
5. **Collapse**: `›` collapses to a 56 px avatar tab at the edge; click the tab to expand. Quit and
   relaunch: the collapsed state is kept.
6. **dock.show / dock.hide**: `dock.hide` in capture hides it; `dock.show` with `side:"left"` shows it
   on the left edge.
7. **Teach**: `session.state` with `mode:"teach"` and the same agent: the dock hides, the cursor
   buddy shows the agent avatar (28 px) instead of the orb. `buddy.point` with `style:"stop"`: the
   avatar shows the `stop` frame while flying and at the halo. Without `agent`: the orb.
8. **Bad avatar**: send an agent whose `idle` is `data:image/png;base64,...` or `javascript:...`:
   the companion logs `dropped part of message: session_avatar_idle`, the session still updates and
   no avatar is shown.
9. **Multi display**: with two displays, the dock sits on the primary display only. Change the primary
   display in System Settings, unplug it, or change its resolution: the dock moves to the new primary
   work area and stays fully on screen.
10. **Unpair**: close the page tab: the dock hides; pair again in capture: the feed is empty.
11. **Chords**: in capture, press `Cmd+Shift+T`, `Cmd+C`, `Option+F4` in other apps: the page receives
    `chord` messages with the frontmost app. Type plain text, `Shift+A`, `Option+G` (`@` on Swiss
    layout), `Enter`, `1`: nothing. Windows: `Ctrl+C`, `Alt+F4` yes; `AltGr+2` nothing.
12. **Password field**: in Safari or System Settings, focus a password field and press `Cmd+A`,
    `Cmd+V`: nothing is sent on macOS (secure input). Windows: record what is sent; only chord names,
    never characters (residual risk documented in `companion/README.md`).
13. **Gates**: tray `Pause sensing`, `off_record: true` in `session.state`, `buddy.state` paused: no
    chords. The companion's own shortcuts (`Option+Space`, `Option+Shift+O/E/P/A`) never appear as chords.
14. **Rollback**: `COMPANION_DOCK=0 npm run dev`: no dock, the orb buddy shows in capture and teach.
    `COMPANION_CHORDS=0`: no chord messages.
15. **Screen capture**: start Capture (whole screen): the dock is not in the frames (content protection);
    note the OS build if it is.
