# design-avatar: side-by-side checks

Canvas source: `Avatar.dc.html` (one avatar, props shape x face x mood) and the avatar rows in `Components.dc.html` ("Clay avatar · 8 states · blob and star" and the six-shape row). Renderer: `src/lib/avatar/render.ts` (`renderAvatarSvg(avatar, state, size, { tile })`).

How to compare: open the canvas artboard next to `/agents/<id>/studio` (or an `<img>` of `renderAvatarSvg(...)` at the same size). Set the canvas `tone` to the avatar colour and `accent` to the avatar accent. For grid rows use `{ tile: true }` at 140 px against the canvas `.tile`.

## Common (every shape, face, state)

| Canvas | Renderer | Compare |
| --- | --- | --- |
| `drop-shadow(±1.6px 0 0 #0A0A0C)` x4 on bead + body | 3.2 px `#0A0A0C` stroke under the fills | [ ] dark outline around body and bead as one silhouette |
| `bodyBg` radial 75% at 34% 30%, tone 30% white -> tone 46% -> tone 74% black | `radialGradient` cx .34 cy .3 r .75, stops 0 / .46 / 1 | [ ] glossy light top-left, darker bottom-right |
| inset `-5px -7px 12px rgba(0,0,0,.18)` and `4px 5px 10px rgba(255,255,255,.55)` | inner-shadow filter (offset, blur, `operator="out"`) | [ ] shade bottom-right edge, sheen top-left edge |
| highlight 22% x 11% of body at 20% / 12%, white .7, blur 2px, rotate -28deg | white ellipse .7, blur 1, `rotate(-28)` | [ ] glossy highlight position and tilt |
| bead 12 px, accent radial at 35% 30% | 12 px circle, accent gradient | [ ] accent bead at `bl, bt` per shape |
| cheeks 10x5 at (27,55) and (63,55), accent .45 | ellipses at (32,57.5) and (68,57.5) | [ ] cheek colour and place |
| ground shadow 56x7 at (22,90), .35 black, blur 3px | ellipse (50,93.5) 28x3.5 | [ ] soft shadow under the body |
| `.tile` radius 18, `linear-gradient(180deg, #232327, #0A0A0C)` | `{ tile: true }`: 140x140 rect rx 18, same gradient, avatar at 100/140 | [ ] dark rounded tile, avatar centred |

## Shape (idle, smile)

| Canvas `S[shape]` | Check |
| --- | --- |
| blob 12,15 76x72, radius `58% 42% 54% 46% / 52% 56% 44% 48%` | [ ] lopsided blob outline |
| round 12,12 76x76, 50% | [ ] circle |
| square 13,13 74x74, 28% | [ ] squircle corners |
| pill 21,9 58x82, 29px; face scale .88 | [ ] tall pill, smaller face |
| bean 8,19 84x64, `48% 52% 44% 56% / 62% 58% 42% 38%`, rotate -6deg; face +3 | [ ] tilted bean |
| star 6,6 88x88 polygon (10 points); face +8, scale .76; bead at 44,-3 | [ ] sharp star, bead on the top tip |

## Face (idle, blob)

| Canvas `eyeBy` / `mouthBy` | Check |
| --- | --- |
| smile: dots 9x14 rotate -12deg at (35,36) and (56,34), blink; smile mouth 15x7 border-bottom 3.5 | [ ] dark tilted oval eyes, right eye 2 px higher, U smile |
| focus: bars 14x5 rotate -6deg; flat mouth 11x3.5 | [ ] slanted bars, flat line |
| curious: ovals 8x12 and 12x17 rotate -10deg, brow 13x3 rotate -16deg; o mouth 9x10 | [ ] uneven eyes, raised right brow |
| calm: closed U arcs 14x8 border-bottom 3.5; calm mouth 11x5 | [ ] content closed eyes |
| wink: left oval, right arc border-top 3.5; smile mouth | [ ] wink |
| robot: 14x13 rx 4 sockets, 5x5 accent pupils with glow; striped mouth 21x6 (3 on, 2 off) | [ ] glowing accent pupils, grille mouth |

## State (blob smile and star wink, as in the Components rows)

| Canvas mood | Renderer | Check |
| --- | --- | --- |
| idle: `aa-bob 3.4s` (-3px, -1.5deg), blink 4.5s (smile only) | translate + rotate SMIL 3.4s, blink keyTimes .93/.96 | [ ] slow bob, blink |
| listening: two accent rings 92 px, scale .88 -> 1.24, fade, 2s, second at 1s; bob; blink | same | [ ] expanding rings |
| thinking: white bubble 34x17 r10 with 1.5 border at (64,0), three 4 px dots pulsing .25 -> 1, 1.2s, .2s steps; flat mouth | same | [ ] thought bubble dots |
| talking: open mouth 13x11 scaleY .35 <-> 1 .45s; two accent arcs at right pulsing 1s (.3s offset); bob | same | [ ] moving mouth, sound arcs |
| asking: accent badge 24 px with 1.5 border, white "?", o mouth | same; badge floats 1.5 px (kept so every state animates) | [ ] "?" badge top right |
| stop: coral #FF8A65 2 px ring + 22 px glow, coral badge with "!", flat mouth | same; glow pulses (kept so every state animates) | [ ] coral halo and "!" |
| happy: closed happy arcs, big mouth 19x11, two accent diamonds, `aa-bob 1.1s` | same | [ ] fast bob, sparkle diamonds |
| paused: grayscale(1) brightness(.72), closed eyes, flat mouth, #2A2A2E badge with two bars | saturate 0 + slope .72; badge pulses (kept so every state animates) | [ ] grey avatar, pause badge |

## Known differences

- `color-mix(in oklab, ...)` is approximated by sRGB mixing.
- The SVG view is shifted up 2 units (`viewBox="0 -2 100 100"`) so the top-right badge at top -2px is not cut; at the bottom the talking arcs and stop glow are clipped at the box edge where the canvas lets them overflow.
- The canvas has no motion for asking, stop and paused; the AVATAR CONTRACT needs every state to animate, so each keeps a small motion on its badge or halo.
