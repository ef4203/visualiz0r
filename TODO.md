# TODO

## Tasks

### 1. Tile Strobe

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
