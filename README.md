# visualiz0r

[![CI](https://github.com/ef4203/visualiz0r/actions/workflows/ci.yml/badge.svg)](https://github.com/ef4203/visualiz0r/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A music visualizer for live performances. It runs full screen in the browser on a laptop connected to an LED wall or projector, and reacts to the level, spectrum and tempo of any audio input.

## Features

- Live audio input from a microphone, audio interface or loopback device
- Real-time level, bass/mid/treble, spectrum and beat analysis
- Switchable visuals via a drop-down menu that hides with the rest of the overlay, drawn on a 2D canvas
- Full-screen stage mode with an auto-hiding overlay and cursor
- Keeps the screen awake during a set
- Small plugin-style API for writing your own visuals

## Getting started

Requires [Node.js](https://nodejs.org/) 24 or newer (Node 26 is recommended).

```sh
git clone https://github.com/ef4203/visualiz0r.git
cd visualiz0r
npm install
npm run dev
```

Open <http://localhost:5173>, connect an audio input and start the visualizer.

> Browsers only allow audio capture on `localhost` or over HTTPS, so serving the dev server over a plain-HTTP LAN address will not work.

## Adding a visual

1. Create `src/visuals/myVisual.ts` exporting a `Visualization` (see [`types.ts`](src/visuals/types.ts) and [`eqBars.ts`](src/visuals/eqBars.ts) for a reference). Its `draw(ctx, frame, size)` is called every frame with an `AudioFrame` containing the spectrum, `level`, `bass`, `mid`, `treble` and `beat` data.
2. Append it to the array in [`src/visuals/index.ts`](src/visuals/index.ts). Its position determines its order in the visual menu.

## Development

| Command           | Description                        |
| ----------------- | ---------------------------------- |
| `npm run dev`     | Start the Vite dev server          |
| `npm run build`   | Type-check and build to `dist`     |
| `npm run preview` | Preview the production build       |
| `npm run lint`    | Lint with [oxlint](https://oxc.rs) |

The project is built with React, TypeScript and Vite, and uses the Web Audio API for analysis. A [devcontainer](.devcontainer) is provided for a ready-to-use environment.

## Roadmap

Planned ideas are tracked in [TODO.md](TODO.md).

## Contributing

Issues and pull requests are welcome. For larger changes, please open an issue first to discuss what you would like to change, and run `npm run lint` and `npm run build` before submitting.

## License

Released under the [MIT License](LICENSE).
