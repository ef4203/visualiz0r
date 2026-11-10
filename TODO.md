# TODO

## Tasks

### 1. Laser Rig

**File:** `src/visuals/laserRig.ts`, `id: 'laser-rig'`, `name: 'Laser Rig'`

**Goal:** A club laser show. Thin, sharp beams fan out from a few points on a dark, hazy stage and move in time with the music.

**Look**

- 2–4 emitter points. Each shoots a fan of straight beams that run past the screen edges.
- Beams are hard-edged and about 1 px thin. Add a wider, very faint pass under them for glow.
- The haze is a very faint, dark gradient around the emitters. The stage stays close to black.
- Mostly monochrome: beams in `INK`, with one accent colour (for example from the `blue()` ramp) on a subset of beams or on the haze.
- Draw additively (`globalCompositeOperation = 'lighter'`) so beam crossings glow.

**Audio mapping**

| Signal              | Effect                                                                                                                                              |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beat.onset`        | Every fan snaps to a new target angle as a hard cut, not an ease. `beat.strength` scales the size of the snap and `beat.pulse` brightens the beams. |
| `mid` (smoothed)    | Drives the slow sweep speed of the fans between kicks.                                                                                              |
| `treble`            | Makes the finest beams flicker. More treble means more flicker.                                                                                     |
| `level`             | Overall brightness. Near silence the rig fades to almost black.                                                                                     |
| Every 8 or 16 beats | Section change (see below).                                                                                                                         |

**Sections:** Cycle through three patterns, without repeating the same one twice in a row.

- **Fan:** beams spread out from each emitter.
- **Cross:** emitters aim at each other so beams cross mid-stage.
- **Parallel:** all beams share one angle and are evenly spaced.

The pattern change may snap or morph over at most 0.25 s.

**Constraints**

- Keep the total beam count to a few hundred line segments. Batch beams into a few paths (one `stroke()` per alpha level), not one path per beam.
- No full-screen flashes. Brightness changes come from the beams, not from filling the screen.

**Done when**

- On a steady four-on-the-floor loop the fan angle visibly snaps on every kick and the pattern changes at section boundaries.
- With silent input the screen is near-black and nothing flickers.
- With the maximum beam count, `draw()` allocates no arrays or objects.

---

### 2. Ridgeline Waterfall

**File:** `src/visuals/ridgeline.ts`, `id: 'ridgeline-waterfall'`, `name: 'Ridgeline Waterfall'`

**Goal:** Stacked spectrum outlines scroll away from the viewer like the _Unknown Pleasures_ cover, forming a rolling mountain range.

**Look**

- 30–40 stacked lines. Each is a snapshot of the spectrum from an earlier moment. The newest is at the front (bottom) and older lines sit further back (higher up the screen). Lines may compress and dim slightly towards the back.
- Each line is a polyline across the width with peaks rising from its own baseline.
- Draw back to front. For each line, first fill the area under it (down to the bottom of the screen) with `STAGE_BACKGROUND`, then stroke it. That hides the lines behind it.
- White (`INK`) lines on black. Only the newest line is stroked in the accent colour (for example from the `blue()` ramp).
- No glow and no gradients. Hard-edged and minimal.

**Audio mapping**

| Signal            | Effect                                                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `beat.onset`      | Spawns a new line. If more than about 1 s passes without one, spawn anyway so the stack keeps moving in silence or without a detected beat. |
| Line content      | `bandSpectrum(frame, row, 40, 16000)` with about 96 bands, copied into a preallocated ring buffer when the line spawns.                     |
| `bass` (smoothed) | Scales the peak height of the foreground lines, fading to no effect towards the back.                                                       |
| `beat.pulse`      | Pushes the whole stack towards the viewer (shift down and/or scale up slightly) and lets it settle back.                                    |

When a line spawns, existing lines glide up by one row pitch using exponential smoothing, not a jump.

**Constraints**

- Use a fixed-size ring buffer of `Float32Array` rows. No per-frame allocation.
- Clamp peak height (for example to about 25% of the screen height) so one line can never cover the whole screen.
- Line width scales with the short screen side and is at least 1 px.

**Done when**

- A nearer line always hides the lines behind it, and no line shows through a fill.
- New lines appear on beats and the stack glides rather than jumps.
- Silent input shows flat lines that keep scrolling slowly.

---

### 3. Tile Strobe

**File:** `src/visuals/tileStrobe.ts`, `id: 'tile-strobe'`, `name: 'Tile Strobe'`

**Goal:** A brutalist black-and-white grid of blocks that flips in hard cuts, where each kind of hit flips a different shape so the beat sync is easy to read.

**Look**

- The screen is a grid of square tiles, roughly 10–14 along the short side. Recompute the grid when the size changes.
- Only two colours: `STAGE_BACKGROUND` and `INK`. No fades, no easing, no gradients.
- Snap tile rectangles to whole pixels so no seams appear between tiles. Draw all white tiles in one path and one fill.

**Audio mapping**

| Signal              | Effect                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `beat.onset` (kick) | Flips one big block, about 1/6–1/4 of the screen. `beat.strength` scales its size and its position changes each time.                                                  |
| Snare or clap       | Flips a full-height vertical bar, 1–2 tiles wide. Detect it locally as a rising edge of `mid` (above a slow moving average, with a refractory period of about 120 ms). |
| Hi-hat              | Flips a single random tile. Detect it locally as a rising edge of `treble` (refractory about 50 ms) and allow only a few flips per frame.                              |
| Every 8 or 16 beats | Section change: switch the base pattern (see below).                                                                                                                   |

**Sections and flips**

- The base pattern cycles through rows, checkerboard, diagonals and random clusters, without repeating the same one twice in a row.
- A flip inverts the affected tiles on top of the base pattern. Each flip reverts after a short hold (suggested: about a quarter of a beat for tiles and half a beat for bars and blocks, with a 0.5 s beat period when `bpm` is 0). This keeps the screen from drifting away from the pattern.

**Photosensitivity cap (required, always on)**

Live events include photosensitive viewers. Large-area flips must not exceed about 3 full-screen equivalents per second (cf. WCAG 2.3.1, three flashes per second).

- Implement it as a token bucket. Tokens refill at 3 per second up to a cap of 1. A flip costs the fraction of the screen it covers. If the bucket cannot pay for a flip, skip it.
- Section switches draw from the same bucket, based on the fraction of tiles they change.
- Name the constant clearly (for example `MAX_FULLSCREEN_FLIPS_PER_S`) and comment why it exists.
- Do not add a safe-mode toggle or UI; the cap is unconditional.

**Constraints**

- Do not touch `src/audio/`. If the local snare or hi-hat detection proves unreliable, note it in the final message as a follow-up (band onsets in `AudioFrame`) instead of doing it here.

**Done when**

- Kicks, snares and hi-hats are visibly different shapes and land on their hits.
- Forcing a trigger every frame during testing still keeps large-area flips at or below the cap.
- Silent input shows the base pattern with no flips.
