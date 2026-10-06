# Manual checks: capture-scope (T-0311)

Window-first capture: the browser picker opens on windows, the share reports its surface, and the macOS companion uses the system picker.

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
