import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import puppeteer from 'puppeteer'
import { createServer } from 'vite'
import { renderDemoTrack } from './demoTrack.ts'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outDir = join(root, 'docs/images/visuals')

const VIEWPORT = { width: 1280, height: 720 }
const VISUAL_SELECT = 'select[aria-label="Visual"]'

const { values: args } = parseArgs({
  options: {
    warmup: { type: 'string', default: '15' },
    only: { type: 'string', multiple: true },
    format: { type: 'string', default: 'webp' },
    quality: { type: 'string', default: '80' },
    help: { type: 'boolean', short: 'h' },
  },
})

if (args.help) {
  console.log(`Usage: npm run docs:screenshots -- [options]

Starts the app against a synthesized demo track and writes one screenshot per
visual to docs/images/visuals.

  --warmup <seconds>  Time each visual runs before its screenshot (default 15)
  --only <file-name>  Only capture this visual, e.g. --only eq-bars (repeatable)
  --format <type>     webp, jpeg or png (default webp)
  --quality <0-100>   Compression quality for webp and jpeg (default 80)`)
  process.exit(0)
}

if (args.format !== 'webp' && args.format !== 'jpeg' && args.format !== 'png') {
  throw new Error(`Invalid --format value: ${args.format}`)
}
const format = args.format
const quality = Number(args.quality)
if (!Number.isInteger(quality) || quality < 0 || quality > 100) {
  throw new Error(`Invalid --quality value: ${args.quality}`)
}

const warmupMs = Number(args.warmup) * 1000
if (!Number.isFinite(warmupMs) || warmupMs < 0) {
  throw new Error(`Invalid --warmup value: ${args.warmup}`)
}

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

/** Chrome is not downloaded on `npm install`, so fetch it on first use unless one is configured. */
async function ensureBrowser(): Promise<string> {
  const path = await puppeteer.executablePath()
  if (existsSync(path)) return path

  console.log('Downloading Chrome for Puppeteer (first run only)...')
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
  const result = spawnSync(npx, ['puppeteer', 'browsers', 'install', 'chrome'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
  if (result.status !== 0 || !existsSync(path)) {
    throw new Error(
      'Could not download Chrome. Install Chrome yourself and set PUPPETEER_EXECUTABLE_PATH to it.',
    )
  }
  return path
}

const executablePath = await ensureBrowser()
const workDir = await mkdtemp(join(tmpdir(), 'visualiz0r-screenshots-'))
const trackPath = join(workDir, 'demo-track.wav')
await writeFile(trackPath, renderDemoTrack())

const server = await createServer({
  root,
  logLevel: 'error',
  server: { host: 'localhost' },
})
await server.listen()
const url = server.resolvedUrls?.local[0]
if (!url) throw new Error('The Vite dev server did not report a URL.')

const browser = await puppeteer.launch({
  executablePath,
  args: [
    // Feed the demo track to getUserMedia instead of a real microphone, and skip the permission prompt.
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${trackPath}`,
    // The sandboxed audio service is not allowed to read the track file.
    '--disable-features=AudioServiceSandbox',
    '--autoplay-policy=no-user-gesture-required',
  ],
  defaultViewport: VIEWPORT,
})

try {
  const page = await browser.newPage()
  page.on('pageerror', (error) => console.error('Page error:', error))
  await page.goto(url)

  await page.locator('button ::-p-text(Connect audio input)').click()
  await page.waitForSelector('button[type="submit"]:not([disabled])')
  await page.locator('button[type="submit"]').click()
  await page.waitForSelector(VISUAL_SELECT)

  const options = await page.$$eval(`${VISUAL_SELECT} option`, (nodes) =>
    nodes.map((node) => ({
      value: (node as HTMLOptionElement).value,
      name: node.textContent ?? '',
    })),
  )
  const wanted = new Set(args.only)
  const visuals = options
    .map((option) => ({ ...option, file: slugify(option.name) }))
    .filter((visual) => wanted.size === 0 || wanted.has(visual.file))
  const unknown = [...wanted].filter((file) => !visuals.some((visual) => visual.file === file))
  if (unknown.length > 0) {
    throw new Error(`Unknown visual(s): ${unknown.join(', ')}`)
  }

  await mkdir(outDir, { recursive: true })
  for (const visual of visuals) {
    await page.select(VISUAL_SELECT, visual.value)
    await new Promise((resolve) => setTimeout(resolve, warmupMs))
    // The overlay hides itself after a few seconds without input.
    await page.waitForSelector('.stage--idle', { timeout: 10_000 })
    const path = join(outDir, `${visual.file}.${format === 'jpeg' ? 'jpg' : format}`)
    await page.screenshot({
      path,
      type: format,
      quality: format === 'png' ? undefined : quality,
    })
    console.log(`${visual.name} -> ${path.slice(root.length)}`)
  }
} finally {
  await browser.close()
  await server.close()
  await rm(workDir, { recursive: true, force: true })
}
