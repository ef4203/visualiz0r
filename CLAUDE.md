# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Requires Node >= 24.

- `npm run dev` - Vite dev server at http://localhost:5173. Audio capture only works on `localhost` or HTTPS, so a plain-HTTP LAN address won't work.
- `npm run build` - `tsc -b && vite build` (type-check, then bundle to `dist`)
- `npm run lint` - oxlint (config in `.oxlintrc.json`)
- `npm test` - unit tests with the built-in `node:test` runner (`node --test "src/**/*.test.ts"`)
- `npm run docs:screenshots` - regenerate `docs/images/visuals` with Puppeteer (see below)

CI (`.github/workflows/ci.yml`) runs `npm run lint`, `npm test` and `npm run build` on Node 24 and 26, and PRs are expected to pass all three.

Tests are `src/**/*.test.ts`, run directly by Node with no extra dependencies, so keep them free of non-erasable syntax and use explicit `.ts` imports. They are excluded from `tsconfig.app.json` (no Node types in the app) and type-checked by `tsconfig.node.json` during `npm run build`. `src/visuals/visuals.test.ts` iterates the `visualizations` registry, so a new visual is covered automatically. It draws against a recording mock 2D context and fails on throws, non-finite values, negative radii, unbalanced `save`/`restore` and mutation of the `AudioFrame`. If a visual uses a canvas API the mock handles specially, check the mock.

Style: Prettier-style no semicolons and single quotes (`.prettierrc`), 2-space indent, LF (`.editorconfig`). TypeScript is strict about unused locals/params, and `erasableSyntaxOnly` is on, so no enums, namespaces or parameter properties. Imports use explicit `.ts`/`.tsx` extensions.

## Architecture

A single-page React app, with no router or state library. `App` holds one long-lived `AudioEngine` and switches between `SetupScreen` (pick an input device) and `Stage` (full-screen canvas) via a `running` flag.

Data flows in one direction, once per animation frame:

1. `Stage` starts a rAF loop (`frameLoop.ts`) and calls `engine.update(now)`.
2. `AudioEngine` (`src/audio/`) samples a Web Audio `AnalyserNode` and runs `SpectrumProcessor` (auto-gained spectrum, level, bass/mid/treble, onset bands) and `BeatDetector` (onsets, tempo, pulse). It returns an `AudioFrame` (`audio/types.ts`).
3. `Stage` passes that frame to the active visual's `draw(ctx, frame, size)` on a 2D canvas.

Details that span several files:

- **`AudioFrame` is a single reused object.** The engine mutates the same frame and the same `Float32Array`s every tick. Visuals must read from it, never retain it or its arrays.
- **Visuals are plugins.** A `Visualization` (`visuals/types.ts`) has an `id`, a `name` and `create()`, which returns an instance with `draw` and an optional `dispose`. `create()` runs each time the visual is selected, so per-visual state belongs in the instance's closure. The canvas is not cleared for you. To add a visual, export it from its own file and append it to the array in `visuals/index.ts`, whose order is the menu order. `eqBars.ts` is the reference implementation. Shared helpers are `audio/bands.ts` (`bandSpectrum`, log-spaced resampling) and `visuals/palette.ts`.
- **The canvas context is pre-scaled** for `devicePixelRatio` (capped by `MAX_DPR = 2` in `Stage.tsx`). `size` is in CSS pixels, so draw in CSS pixels.
- **Audio input is deliberately raw.** `getUserMedia` is requested with echo cancellation, noise suppression and AGC off, and the analyser is intentionally not connected to `ctx.destination` (it would feed a live mic back through the speakers). Keep both when touching `AudioEngine.start`.
- **Async start is guarded by `startToken`.** A newer `start()` or `stop()` invalidates an in-flight one, which then releases its stream. Preserve this when adding awaits to `start`.
- **Input loss** is reported through `engine.subscribeEnded`, which `Stage` uses to show the "Audio input lost" alert.
- **`BeatDetector` tempo is clamped to 70-160 BPM** (`MIN_BPM`/`MAX_BPM`), so faster music reads at half tempo. `TODO.md` lists this as a known limitation.

`TODO.md` is the roadmap, with some known bugs. It lists hotkeys, persisted settings, a PWA and audio-core tests as planned, plus explicit out-of-scope items (per-visual settings UI, plugin loader UI, WebGL rewrite, video export, MIDI). Check it before proposing features.

## Docs and screenshots

User-facing docs are in `docs/` (user guide, display setups, troubleshooting). The visual images in the user guide are generated, so after adding or changing a visual run `npm run docs:screenshots` and commit the updated images. The script (`scripts/screenshots/`) starts the app, plays a synthesized demo track (`demoTrack.ts`) as a fake microphone, and captures every visual in the menu. It runs TypeScript directly with Node, so keep it free of non-erasable syntax. The first run downloads Chrome (~150 MB); set `PUPPETEER_EXECUTABLE_PATH` to use an installed one. Options include `--only <visual-id>`, `--warmup`, `--format` and `--quality` (pass after `--`, e.g. `npm run docs:screenshots -- --only eq-bars`).

`vite.config.ts` sets `base: './'`, and `.github/workflows/deploy.yml` publishes to GitHub Pages, so keep asset paths relative.
