# agents-avatar: manual checks

1. Open /agents/<id>/studio signed in. The preview shows the clay avatar on a dark panel.
2. Click every shape and face chip; the preview updates at once.
3. Pick each palette colour and accent, then type a custom hex (e.g. #123ABC); the preview follows. An invalid hex is ignored.
4. Click each animation button (idle, listening, thinking, talking, asking, stop, happy, paused) and check the motion: breathe and blink, lean and pulse ring, orbiting dots, mouth moving, head tilt with '?', red halo and palm, bounce with closed-eye smile, grey with 'z'.
5. Randomize changes shape, face and colours.
6. Export SVG downloads an .svg that opens in a browser and still animates. Export PNG downloads a 512x512 .png.
7. Save: until PATCH /api/agents/[id] (A1) is merged, expect "save failed (404)"; after A1, expect "Saved" and the avatar persists on reload once the page loads it.
