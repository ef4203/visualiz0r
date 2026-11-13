# CLAUDE.md

## Commands

Node >= 24.

- `npm run dev` - Vite at http://localhost:5173 (audio capture needs `localhost` or HTTPS, not a LAN HTTP address)
- `npm run build` - `tsc -b && vite build`
- `npm run lint` - oxlint (`.oxlintrc.json`)
- `npm test` - `node --test "src/**/*.test.ts"`
- `npm run docs:screenshots` - regenerate `docs/images/visuals` (Puppeteer)

CI (`.github/workflows/ci.yml`) runs lint, test and build on Node 24 and 26; PRs must pass all three.

Tests (`src/**/*.test.ts`) run directly under Node with no deps: no non-erasable syntax, explicit `.ts` imports. They're excluded from `tsconfig.app.json` and type-checked by `tsconfig.node.json` in the build. `src/visuals/visuals.test.ts` iterates the `visualizations` registry, so new visuals are covered automatically. It draws on a recording mock 2D context and fails on throws, non-finite values, negative radii, unbalanced `save`/`restore` and `AudioFrame` mutation. If a visual uses a canvas API the mock handles specially, check the mock.

Style: no semicolons, single quotes, 2-space indent, LF. Strict unused locals/params. `erasableSyntaxOnly`: no enums, namespaces or parameter properties. Explicit `.ts`/`.tsx` import extensions.

## Architecture

Single-page React app, no router or state library. `App` holds one long-lived `AudioEngine` and toggles `SetupScreen` (pick input) / `Stage` (full-screen canvas) via `running`.

Per animation frame (one-way): `Stage` rAF loop (`frameLoop.ts`) calls `engine.update(now)`. `AudioEngine` (`src/audio/`) samples a Web Audio `AnalyserNode`, runs `SpectrumProcessor` (auto-gained spectrum, level, bass/mid/treble, onset bands) and `BeatDetector` (onsets, tempo, pulse), and returns an `AudioFrame` (`audio/types.ts`). `Stage` passes it to the active visual's `draw(ctx, frame, size)`.

- **`AudioFrame` is one reused object**; the engine mutates it and its `Float32Array`s every tick. Visuals must only read it, never retain it or its arrays.
- **Visuals are plugins.** `Visualization` (`visuals/types.ts`): `id`, `name`, `create()` returning `draw` plus optional `dispose`. `create()` runs on each selection, so keep per-visual state in the closure. The canvas isn't cleared for you. To add one, export it from its own file and append it to `visuals/index.ts` (array order = menu order). `eqBars.ts` is the reference. Helpers: `audio/bands.ts` (`bandSpectrum`, log-spaced resampling), `visuals/palette.ts`.
- **Canvas context is pre-scaled** for `devicePixelRatio` (`MAX_DPR = 2` in `Stage.tsx`); `size` is CSS pixels, so draw in CSS pixels.
- **Audio input is deliberately raw:** `getUserMedia` with echo cancellation, noise suppression and AGC off; the analyser is not connected to `ctx.destination` (would feed the mic back through speakers). Keep both when touching `AudioEngine.start`.
- **Async start is guarded by `startToken`:** a newer `start()`/`stop()` invalidates an in-flight one, which releases its stream. Preserve this when adding awaits.
- **Input loss** goes through `engine.subscribeEnded`; `Stage` shows the "Audio input lost" alert.
- **`BeatDetector` tempo is clamped to 70-160 BPM** (`MIN_BPM`/`MAX_BPM`), so faster music reads at half tempo (known limitation in `TODO.md`).

`TODO.md` is the roadmap and known bugs: planned hotkeys, persisted settings, PWA, audio-core tests; out of scope: per-visual settings UI, plugin loader UI, WebGL rewrite, video export, MIDI. Check it before proposing features.

## Docs and screenshots

User docs are in `docs/`. After adding or changing a visual, run `npm run docs:screenshots` and commit the images. The script (`scripts/screenshots/`) starts the app, plays a synthesized track (`demoTrack.ts`) as a fake mic and captures every menu visual. It runs TypeScript directly under Node (no non-erasable syntax). First run downloads Chrome (~150 MB); set `PUPPETEER_EXECUTABLE_PATH` to use an installed one. Options after `--`: `--only <visual-id>`, `--warmup`, `--format`, `--quality`.

`vite.config.ts` sets `base: './'` and `deploy.yml` publishes to GitHub Pages, so keep asset paths relative.
