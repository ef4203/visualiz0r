# visualiz0r

Music visualizer for live performances. Runs full screen on a laptop connected to an LED wall or projector and reacts to the level, spectrum and tempo of an audio input.

## Start with

    npm run dev -- --host 0.0.0.0

Open it via `http://localhost:5173`. Browsers only allow audio capture on `localhost` or `https://`, so opening the dev server through a LAN IP over plain http will not work.

## Using it

1. Click **Connect audio input** and allow access. Pick the input (microphone, audio interface, loopback device, …) and check the level meter.
2. Click **Start visualizer**. It goes full screen.

| Key       | Action                          |
| --------- | ------------------------------- |
| `1`–`9`   | Switch visual                   |
| `F`       | Toggle fullscreen               |
| `S`       | Back to input selection         |

The on-screen overlay (visual list, detected BPM, input name) fades out after 3 seconds and the cursor hides; move the mouse or press a key to bring it back.

## Adding a visual

1. Create `src/visuals/myVisual.ts` exporting a `Visualization` (see `src/visuals/types.ts` and `eqBars.ts`). `create()` returns an instance whose `draw(ctx, frame, size)` is called every frame with an `AudioFrame`: spectrum, `level`/`bass`/`mid`/`treble`, and `beat` (`onset`, `pulse`, `bpm`).
2. Append it to the array in `src/visuals/index.ts`. Its position is its hotkey.

`bandSpectrum()` in `src/audio/bands.ts` resamples the spectrum into any number of log-spaced bands.

## Implement next

Ideas for further visuals, aimed at electronic and techno sets. They lean on hard edges and high contrast, where the current visuals are smooth and colourful.

- **Laser Rig.** Thin, sharp beams fan out from a few points on a dark, hazy stage, like a club laser show. The beams sweep slowly with the mids and snap to a new fan angle on every kick. Hi-hats and treble make the finest beams flicker. Section changes (every 8 or 16 beats) switch between fan, cross and parallel patterns. Mostly monochrome with one accent colour, drawn additively so crossings glow.
- **Ridgeline Waterfall.** Stacked spectrum outlines scroll away from the viewer, one new line per beat or per fixed time step, like the *Unknown Pleasures* cover. Each line is filled black so it hides the lines behind it, giving a rolling mountain range. Bass raises the foreground peaks and the beat pushes the whole stack forward. White lines on black, with only the newest line tinted in the accent colour.
- **Tile Strobe.** The screen is split into a grid of blocks that flip between black and white in hard cuts, with a pattern that changes per section (rows, checkerboard, diagonals, random clusters). The kick flips big blocks, the snare or clap flips a vertical bar and hi-hats flip single small tiles. Brutalist and minimal, and the sync to the beat is easy to read. Needs a flash-rate cap (around 3 Hz for full-screen flips) or a safe-mode toggle because of photosensitivity at live events.
