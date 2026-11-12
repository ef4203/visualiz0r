import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderScaler } from './renderScale.ts'

function run(s: ReturnType<typeof createRenderScaler>, t: number, dt: number, frames: number) {
  for (let i = 0; i < frames; i++) {
    t += dt
    s.update(t)
  }
  return t
}

test('stays at full scale when frames are steady', () => {
  const s = createRenderScaler()
  run(s, 0, 16.7, 600)
  assert.equal(s.scale, 1)
})

test('drops scale when frame time slips, never below the minimum', () => {
  const s = createRenderScaler()
  let t = run(s, 0, 16.7, 60)
  t = run(s, t, 40, 60)
  assert.ok(s.scale < 1)
  run(s, t, 40, 3000)
  assert.equal(s.scale, 0.5)
})

test('recovers after sustained headroom', () => {
  const s = createRenderScaler()
  let t = run(s, 0, 16.7, 60)
  t = run(s, t, 40, 60)
  assert.ok(s.scale < 1)
  run(s, t, 16.7, 30 * 40)
  assert.equal(s.scale, 1)
})

test('ignores huge gaps such as a hidden tab', () => {
  const s = createRenderScaler()
  let t = run(s, 0, 16.7, 60)
  for (let i = 0; i < 100; i++) {
    t = run(s, t, 5000, 1)
    t = run(s, t, 16.7, 10)
  }
  assert.equal(s.scale, 1)
})

test('drops when slow from the very start', () => {
  const s = createRenderScaler()
  run(s, 0, 33, 600)
  assert.ok(s.scale < 1)
})

test('drops when every frame is a long gap', () => {
  const s = createRenderScaler()
  run(s, 0, 400, 400)
  assert.ok(s.scale < 1)
})

test('accepts a slower display after a refresh change instead of sticking at the floor', () => {
  const s = createRenderScaler()
  let t = run(s, 0, 6.9, 300)
  t = run(s, t, 16.7, 30 * 400)
  assert.ok(s.scale > 0.5)
})

test('failed raises back off', () => {
  const s = createRenderScaler()
  let t = run(s, 0, 16.7, 60)
  t = run(s, t, 40, 30 * 3)
  assert.ok(s.scale < 1)
  // the machine only copes below 0.7: each raise above it fails, so raises must get rarer
  const raises: number[] = []
  let prev = s.scale
  for (let w = 0; w < 400; w++) {
    const heavy = s.scale > 0.7
    t = run(s, t, heavy ? 40 : 16.7, 30)
    if (s.scale > 0.7 && prev <= 0.7) raises.push(w)
    prev = s.scale
  }
  assert.ok(raises.length >= 2)
  const gaps = raises.slice(1).map((r, i) => r - raises[i])
  assert.ok(gaps[gaps.length - 1] > gaps[0])
})
