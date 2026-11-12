# TODO

## Small changes, biggest live payoff

- [ ] **Hotkeys for visuals.** `Stage.tsx` only handles `F` and `S`. Add `1`-`7` and `←/→` to switch visuals, `B` for blackout (a dark overlay div) and `-`/`+` for master brightness (LED walls are very bright up close).
- [ ] **Remember settings.** The visual resets to EQ Bars on every start and only the input device is saved. Persist the last visual and brightness in `localStorage`.
- [ ] **Auto-reconnect a lost input.** The engine already knows the last `deviceId`. Retry on `devicechange` and clear the "Audio input lost" alert when it comes back.
- [ ] **Tap tempo and half/double-time keys.** `BeatDetector.ts` limits tempo to 70-160 BPM, so drum & bass at 174 reads as 87. A manual override is safer than widening the range.
- [ ] **Beat dot and BPM in the HUD and setup meter.** There is currently no way to see whether beat detection is locked before going live.

## Medium effort, high value

- [ ] **Installable offline PWA.** The docs require `npm run dev` at the gig. The app is a static SPA and HTTPS satisfies the microphone requirement, so a manifest and a small service worker would let someone open an app icon with no internet and no terminal.
- [ ] **Tab/system audio capture** via `getDisplayMedia({ audio: true })`. Covers "music on the same laptop" without installing BlackHole or VB-Cable, at least for browser-based players.
- [ ] **Demo audio source** on the setup screen, to try the visuals without hardware and as a deterministic input for testing.
- [ ] **Place the stage on the external display directly** with the Window Management API (Chromium). Removes the "drag the window first, then press F" step that the display-setups and troubleshooting docs spend a lot of space on.
- [ ] **Auto-cycle mode.** An "Auto" entry in the visual menu that switches every N bars with a dip-to-black transition. The same transition also softens manual switches.
- [ ] **Shared bar/phase clock in `BeatState`.** A tempo-locked `phase` and `bar` would replace each visual counting onsets itself (`tileStrobe.ts`, `psychedelic.ts`) and keep pulses in time through missed onsets. Touches the audio core, so higher risk.

## Bigger bet

- [ ] **Pop-out control window** for the laptop screen, linked with `BroadcastChannel`: visual list, blackout, brightness, BPM. The audience display currently shows the drop-down and device label whenever the mouse moves, and hotkeys do not fire when DJ software has focus. Do this only if hotkeys turn out not to be enough.

## Bugs and gaps

- [ ] **Setup screen after an input loss.** `SetupScreen.tsx` only refreshes the device list `if (engine.active)`. After a loss and `S`, the user gets a lone "Connect audio input" button instead of the device picker, and the "disconnected" message never shows because Stage was mounted when it fired. This contradicts the user guide ("press S and pick it again").
- [ ] **Tests for the audio core.** `npm test` (Node's built-in runner) smoke-tests every visual, but nothing covers `src/audio/`. Add tests for `estimateTempo` with synthetic click tracks, `bandSpectrum` and `SpectrumProcessor`.
- [ ] **Developer docs.** `docs/README.md` has no developer section. Document the conventions for visuals: no allocations in `draw`, use `beat.bpm` when known, use the shared palette.

## Out of scope (to keep the app small)

Per-visual settings panels, a plugin loader UI, a WebGL rewrite, video export and MIDI mapping.
