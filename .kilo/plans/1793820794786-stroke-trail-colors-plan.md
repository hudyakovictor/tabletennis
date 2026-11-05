# Phase 1: In-Game Stroke Contact Flash

## Agreed Scope

- Latest user decision: first implement the contact flash in the game. Colored/thicker trails and genuine bot-versus-bot are subsequent stages, not part of this first delivery.
- One subtle local light pulse for each physically accepted racket contact, for both sides in the live `Game` engine: ordinary hits, player/AI serves, successful passive blocks, training and the current physical demo.
- Ordinary `BLOCK` is white; other recognized strokes, including `CHOP_BLOCK`, are colored. Color means the actual accepted stroke, never quality, player identity, current spin or an equipped cosmetic tint.
- Existing trail behavior stays unchanged in phase 1. Its white/quality/cosmetic color may therefore differ from the new flash until the later trail stage uses this same palette.
- Preserve ball appearance, physics, contact legality, grading, `golden`, score, audio/haptics, rewards and inventory. No permanent halo, particle fireworks, new full-screen flash, characters or character shadows.
- Online remote-contact metadata, replay effects, the separate 2D fallback and scripted MENU lobby are explicitly deferred. Locally resolved online contacts can use the same hook, but do not fabricate a remote stroke or advertise full online support yet.

## Palette and Contrast

Use the existing `STROKES.col` metadata in `source/game/tt/src/40_swipe.js:190-211` as the single palette. No new taxonomy or duplicate palette is needed for phase 1. Existing type labels follow these colors; quality-verdict colors remain separate.

Fresh-app MEDIUM play mainly uses `DRIVE`/`LOOP`, with compact `BLOCK`, downward `PUSH` and soft-tap `DROP` (`55_ai.js:624-657`, `40_swipe.js:226-229,331-367`). These are selector expectations, not measured usage percentages. Prioritize contrast between them over keeping all attacks in similar warm hues.

| Stroke | Color | HEX |
| --- | --- | --- |
| `BLOCK` | Cool white | `#F5F7FF` |
| `DRIVE` | Amber-orange | `#FFAB3D` |
| `LOOP` | Clear cyan | `#31D7FF` |
| `PUSH` | Violet | `#B484FF` |
| `DROP` | Fresh green | `#71E595` |
| `FLICK` | Golden yellow | `#FFDD57` |
| `COUNTER` | Hot pink | `#F36BBD` |
| `SMASH` | Coral-red | `#FF4F64` |
| `SIDE` | Emerald-turquoise | `#39CFA8` |
| `CHOP` | Blue | `#658BFF` |
| `LOB` | Soft rose | `#EEAECA` |
| `HOOK` | Orchid | `#D878EC` |
| `FADE` | Blue-teal | `#58B8D0` |
| `BANANA` | Salmon-orange | `#FF9579` |
| `CHOP_BLOCK` | Periwinkle-blue | `#94B5FF` |
| `SERVE_NO_SPIN` | Steel-blue, not white | `#7FAFC2` |

Serve aliases: `SERVE_TOP` -> `LOOP`, `SERVE_BACK` -> `PUSH`, `SERVE_SIDE` -> `SIDE`, `SERVE_FAST` -> `DRIVE`. Resolve glancing `{id:'BLOCK'}` contacts through canonical metadata even if the supplied object has no `.col`; unknown accepted IDs use neutral styling without claiming a classified stroke.

Check actual rendered sequences, especially amber -> cyan -> white -> amber, violet -> cyan, green -> violet and violet -> yellow. Also check `LOOP/COUNTER`, high-ball `LOOP/SMASH`, serve/first-return pairs and deliberate horizontal strokes. HEX swatches alone do not prove these differences survive ACES/bloom or a small phone display.

## Ordered Implementation Tasks

1. **Set the palette and add minimal pulse state.** Update the existing stroke-color metadata; normalize by canonical ID and convert HEX to RGB once per pulse, not per frame. Add a small Game-owned visual pulse record: committed side/shot identity, accepted stroke ID, cloned world contact position, frozen RGB/size, unslowed birth/expiry. Bound simultaneous pulses to at most two. Reuse the existing glow texture and billboard/quad; do not add a generic FX framework, new shader, mesh format or palette module.

2. **Hook accepted contacts, not input or plans.** `70_game.js:1461-1479` (`applyHit`) already covers ordinary/player-serve/AI contacts. Trigger once after its `shotId` commit using `racket.stroke.id` and the supplied `contactP`, not a later moving `ball.p`. Passive held block bypasses `applyHit`: use the original cloned `p0` at `70_game.js:2509`, after commit at `:2514`, before relying on the CCD-displaced ball position. Replace its existing burst (`:2533`) and the quality-colored training contact burst (`:1564-1567`) instead of stacking particles with the pulse. Keep scoring/net effects and feedback audio/haptics unchanged. Successful impact is authoritative even when the later flight is illegal; do not reject an accepted glancing contact just because the solver marked a racket invalid.

3. **Give the flash its own timing and gates.** Duration starts at about 120 ms in unslowed game time (`Game.time`), not `strokeTime`, scaled physics `dt`, particle lifetime or a trail flag. Reject duplicate identities and births during pause, hidden/sleep/context-loss, reduced motion, preview/replay or non-live menu scenes. Clear pulses synchronously on entering those suspended/replaced states: paused worlds still render without updating (`90_boot.js:76-82`). Cover OS motion changes (`70_game.js:279-285`), host settings/rm/sleep (`92_embed.js`), new match/serve, feed replacement and replay entry/exit. Reset visual dedup bookkeeping when installing a new match/ball generation so reused numeric shot IDs cannot suppress its first pulse. A point result may let an already-born pulse finish its short fade; it must not create or respawn one. Never modify gameplay clocks, ball position, `shotId` or `_hitSeq` for visual cleanup. `showTrail=false` and `trailLen=0` do not disable this independent flash.

4. **Render one restrained contact glow.** Add the pulse draw to live Game FX, anchored to its frozen contact point, not the ball's later position or the paddle center. Start with quadratic fade-out, peak opacity roughly 0.20-0.25, outer diameter at most about 2.2 visible ball diameters. Use unlit colored emission plus the glow texture's alpha; white lit albedo can wash color out (`20_gl.js:304,349`). Do not raise global bloom or add another peripheral/full-screen flash. The ball must remain sharp and brightest. Reuse existing renderer calls; changing `Particles.spawn`, its clocks or its trail flags would incorrectly slow/gate the new effect (`61_particles.js:37-45`, `70_game.js:4728`).

5. **Verify, then rebuild through the source pipeline.** Add focused contact-flash tests and extend actual mouse/touch/serve cases in `slowmo-hit.test.js`; keep audio-event tests passing. Explicitly cover both sides, passive `p0`, canonical BLOCK fallback, CHOP_BLOCK, missed/cancelled input, duplicate release/contact, feeder spawn and table/net bounces. Run engine `npm test` in `source/game`, existing browser checks for the real renderer, and shell `node --test --test-concurrency=1 tests/*.test.cjs` in `source`. Rebuild the shipped app with `python3 source/build.py`; never hand-edit `play/index.html`. Preserve unrelated dirty-tree changes. No commit or push is requested.

## Acceptance and Failure Cases

- One pulse per accepted ordinary, passive-block and serving contact; no pulse from a gesture preview, miss, feeder staging or table/net collision. Pulse position and color do not change after birth.
- BLOCK is white, CHOP_BLOCK is blue, and all 20 IDs resolve. Grade and `t-gold`/`t-coral` cannot override the pulse; their existing trail/inventory behavior is untouched in phase 1.
- Lifetime remains about 120 real ms at 30/60/120 FPS and during slow motion. Pause/hidden/sleep/RM cannot leave a frozen pulse or resurrect it on resume. Turning the ribbon off leaves the contact pulse available.
- Rendered checks at 390x844, mobile landscape and 1280x720, DPR 1/2/3, on table and panorama backgrounds. Compare the primary pairs at actual ball size and in consecutive contacts; adjust intensity, not hue identities, if bloom/tonemapping makes them whitish. No new GPU effects allocation per frame.
- Physics, contact counts, score, grade, audio/haptics, existing trail timing and menu/preloader handoff remain unchanged. Textual stroke/quality feedback stays available; do not claim universal color-vision accessibility for 20 hues.

## Following Stages, Not Implemented Now

1. **Colored/thicker trails.** Reuse the same palette, modestly widen the 3D ribbon (0.011 -> about 0.015 m half-width) and keep duration calibration. Incoming spans retain their old color until fading; new spans start at the true contact with no hue blending. Keep seam samples immutable, coalesce only a mutable same-contact tail, find nonzero tangents within a span and emit no cross-contact triangles. Sampling, trim/calibration and all parallel metadata need one explicit source clock and atomic resets; gate residual POINT sampling without changing ball physics.

2. **True bot-versus-bot engine/spectator/debug mode.** One live production `Game`: the same physics, collisions, racket motions, serves and accepted-contact pipeline, watched from the normal player-end game camera. `BROADCAST` is the existing legacy name for that playing view, not a TV orbit (`57_camera.js:31-40`); reuse `Game.updateCamera`, not lobby/preview cameras. Existing `startDemo` uses match physics, but its near side is an upward-swipe autopilot, not a second full AI (`70_game.js:4043-4163`). Full two-sided control needs independent, side-aware AI/contact contexts: merely setting `ai.side=1` cannot remove hardcoded far-side targets, interception checks and paddle ownership. Keep paddles only and reuse the same contact effects. Add an explicit noncompetitive spectator/debug lifecycle, excluded from progression, rewards and player match records. There is no embedded demo-start command now; do not masquerade as an ordinary host `match` or the analytic MENU exhibition when adding future controls.

3. **Maximum-diversity debugging policy.** Alongside natural play, prioritize eligible, least-used successful types; choose from five serve IDs during serves and fifteen rally IDs during exchanges. Respect real opportunities: BANANA needs a short low backhand ball, CHOP_BLOCK needs fast heavy topspin, SMASH needs height. Create them through legitimate preceding serves/placements, or explicit isolated training fixtures; full coverage may require several points/scenarios, not forced impossible contacts in one rally. Track requested/chosen/accepted IDs, rejection/fallback and actual outgoing speed/spin/landing per side; count accepted IDs for diversity. Reuse diagnostics and the existing embedded accepted `hit` reporting. Repeatability must record seed, request sequence, initial tuning/equipment/state and controller cadence. AI has injectable randomness (`55_ai.js:204-218`), but toss/net randomness must also be controlled separately from cosmetic randomness. Exact controls and the two-sided refactor get their own plan before implementation.

4. **Replay, online and any fallback integration.** Add truthful sparse contact metadata without changing replay beauty counts; select replay events with clip time but age flashes with an advancing FX clock, including final holds. Online needs origin/sequence deduplication, mirrored side/point and predicted-hit acknowledgement. Missing metadata must not fabricate colors or revive expired flashes. The separate 2D/MENU implementations only reuse colors when they have truthful executed stroke IDs; a rotating palette is not an AI simulation.

## Plan Status

Current implementation target is phase 1 only. Subsequent stages are requirements, not authorization to implement them in this delivery. Palette readability still requires real rendered validation. Planning edits only this Markdown file and runs no builds or tests; source implementation requires an implementation-capable agent.
