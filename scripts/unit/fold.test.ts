// The fold switch's two stories (src/desk/fold.ts) played against a fake clock: the machine that
// says which one is on — off is a blast that ends folded, on is a build that ends open, an unfold
// mid-blast cuts to the build, a double flip is one story, reduced motion is a cut — and the
// timelines each reads: the flash, the wave, the cloud, a hamster's end, and the construction's
// lift, which the vertex shader (src/desk/vox/material.ts) computes from the same constants and so
// must add exactly nothing at rest.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { H_OFFICE, OFFICE, T, tileToWorld } from '../../src/desk/office-world'
import {
  BLAST,
  BLAST_REST,
  BLAST_S,
  BUILD,
  BUILD_REST,
  BUILD_S,
  CENTRE,
  PANE_S,
  STORY_CLOSE,
  STORY_MARGIN,
  STORY_MAX_SCALE,
  STORY_ZOOM_OUT,
  buildDelay,
  blendView,
  builder,
  doomAt,
  easeOutBack,
  fireball,
  flashAlpha,
  foldAge,
  foldAt,
  foldFlip,
  foldLift,
  foldPlaying,
  foldRemaining,
  foldSettle,
  foldShown,
  paneShut,
  landTime,
  mushroom,
  ringAlpha,
  shakeOffset,
  shockRadius,
  storyBounds,
  storyMix,
  storyScale,
  tileJitter,
} from '../../src/desk/fold'

const near = (a: number, b: number, eps = 1e-9): boolean => Math.abs(a - b) <= eps

test('the machine: off blows up and ends folded, on builds and ends open, and the flips in between', () => {
  // the app starts with the studio up: nothing plays
  let fx = foldAt(false, 1000)
  assert.equal(fx.phase, 'open')
  assert.ok(foldShown(fx) && !foldPlaying(fx))
  assert.equal(foldRemaining(fx, 1000), null)
  // off: the blast, for BLAST_S, then folded away
  fx = foldFlip(fx, true, 2000)
  assert.equal(fx.phase, 'blast')
  assert.equal(fx.since, 2000)
  assert.ok(foldShown(fx) && foldPlaying(fx), 'the studio stays mounted through the blast')
  assert.equal(foldRemaining(fx, 2000), BLAST_S * 1000)
  assert.equal(foldRemaining(fx, 2000 + BLAST_S * 1000 + 50), 0)
  assert.equal(foldAge(fx, 3500), 1.5)
  fx = foldSettle(fx, 7000)
  assert.equal(fx.phase, 'closed')
  assert.ok(!foldShown(fx))
  // on: the build, for BUILD_S, then open
  fx = foldFlip(fx, false, 9000)
  assert.equal(fx.phase, 'build')
  assert.equal(foldRemaining(fx, 9000), BUILD_S * 1000)
  fx = foldSettle(fx, 9000 + BUILD_S * 1000)
  assert.equal(fx.phase, 'open')
  // settling a resting phase changes nothing
  assert.equal(foldSettle(fx, 20000), fx)
  // the two stories are about five seconds each
  assert.ok(BLAST_S >= 4 && BLAST_S <= 6 && BUILD_S >= 4 && BUILD_S <= 6)
})

test('an unfold mid-blast cuts to the build, a fold mid-build cuts to the blast, and a double flip is one story', () => {
  const blast = foldFlip(foldAt(false), true, 100)
  const cut = foldFlip(blast, false, 1300)
  assert.equal(cut.phase, 'build')
  assert.equal(cut.since, 1300, 'the build starts from its own top')
  const back = foldFlip(cut, true, 2000)
  assert.equal(back.phase, 'blast')
  assert.equal(back.since, 2000)
  // the same flip again, while its story plays or once it has settled, is not a second story
  assert.equal(foldFlip(back, true, 2500), back)
  const closed = foldAt(true, 0)
  assert.equal(foldFlip(closed, true, 5), closed)
  const open = foldAt(false, 0)
  assert.equal(foldFlip(open, false, 5), open)
  assert.equal(foldFlip(cut, false, 1400), cut)
})

test('reduced motion is a cut to the resting state, in both directions', () => {
  const off = foldFlip(foldAt(false, 0), true, 10, true)
  assert.equal(off.phase, 'closed')
  assert.ok(!foldShown(off))
  const on = foldFlip(off, false, 20, true)
  assert.equal(on.phase, 'open')
  const mid = foldFlip(foldFlip(foldAt(false, 0), true, 10), false, 500, true)
  assert.equal(mid.phase, 'open', 'even out of a playing blast')
})

test('the blast: a blink of white, a wave that crosses the island, a cloud that stands and thins, a hamster gone in under a second', () => {
  // the flash: nothing before, full from the first frame through FLASH_IN, gone well before the end
  assert.equal(flashAlpha(-0.1), 0)
  assert.equal(flashAlpha(0), 1)
  assert.equal(flashAlpha(BLAST.FLASH_IN), 1)
  assert.ok(flashAlpha(0.3) > 0 && flashAlpha(0.3) < 0.5)
  assert.equal(flashAlpha(2), 0)
  // the wave leaves a beat after the flash and is past the island's edge (about 1000 units) before two seconds
  assert.equal(shockRadius(0), 0)
  assert.equal(shockRadius(BLAST.RING_AT), 0)
  assert.ok(shockRadius(2) > 1000)
  assert.equal(ringAlpha(0), 0)
  assert.ok(ringAlpha(BLAST.RING_AT + 0.001) > 0.99)
  assert.equal(ringAlpha(BLAST.RING_AT + BLAST.RING_LIFE), 0)
  // the shake: still before the wave reaches the camera, biggest soon after, a tenth of that by the end, and sized to the distance
  assert.deepEqual(shakeOffset(0, 500), { x: 0, y: 0, z: 0 })
  const peak = Math.hypot(shakeOffset(BLAST.SHAKE_AT + 0.13, 500).x, shakeOffset(BLAST.SHAKE_AT + 0.13, 500).y, shakeOffset(BLAST.SHAKE_AT + 0.13, 500).z)
  assert.ok(peak > 0 && peak < BLAST.SHAKE * 500 * 1.8)
  const late = shakeOffset(BLAST_S, 500)
  assert.ok(Math.hypot(late.x, late.y, late.z) < peak * 0.1)
  const far = shakeOffset(BLAST.SHAKE_AT + 0.13, 2000)
  assert.ok(Math.abs(far.x) > Math.abs(shakeOffset(BLAST.SHAKE_AT + 0.13, 500).x) * 3.9)
  // the fireball grows, holds, cools and is gone
  assert.ok(fireball(0).r < fireball(0.5).r && fireball(0.5).r < fireball(BLAST.BALL_GROW).r)
  assert.equal(fireball(0.2).alpha, 1)
  assert.equal(fireball(BLAST.BALL_GONE).alpha, 0)
  assert.equal(fireball(0).heat, 0)
  assert.equal(fireball(BLAST.BALL_GONE).heat, 1)
  // the cloud: nothing before it starts, full height by the rise, thinning to nothing before the story ends
  assert.equal(mushroom(0).body, 0)
  const full = mushroom(BLAST.CLOUD_AT + BLAST.CLOUD_RISE)
  assert.ok(near(full.stem, BLAST.CLOUD_H) && near(full.cap, BLAST.CLOUD_R1) && full.body === 1 && full.smoke === 1)
  assert.ok(mushroom(BLAST.CLOUD_AT + 0.1).smoke < 0.2, 'it starts as fire')
  assert.ok(mushroom(BLAST.CLOUD_FADE_AT + BLAST.CLOUD_FADE / 2).body < 1, 'thinning')
  assert.equal(mushroom(BLAST.CLOUD_FADE_AT + BLAST.CLOUD_FADE).body, 0)
  assert.ok(BLAST.CLOUD_FADE_AT + BLAST.CLOUD_FADE <= BLAST_S, 'the cloud has thinned away before the studio folds')
  // a hamster the wave has reached: thrown out and up, shrinking to nothing in DOOM_S, then staying nothing
  assert.deepEqual(doomAt(0), { out: 0, up: 0, scale: 1, spin: 0 })
  const mid = doomAt(BLAST.DOOM_S / 2)
  assert.ok(mid.out > 0 && mid.up > 0 && mid.scale > 0 && mid.scale < 1 && mid.spin > 0)
  assert.equal(doomAt(BLAST.DOOM_S).scale, 0)
  assert.equal(doomAt(BLAST.DOOM_S * 3).scale, 0)
  assert.ok(doomAt(BLAST.DOOM_S * 3).up >= 0, 'never through the floor')
  // up into the sky, not off to the side: still climbing when the last of it is gone
  const gone = doomAt(BLAST.DOOM_S)
  assert.ok(gone.up > gone.out * 4, `up ${gone.up} vs out ${gone.out}`)
  assert.ok(gone.up > doomAt(BLAST.DOOM_S / 2).up)
  // every seat is inside the wave's reach well before the story ends
  const reach = shockRadius(BLAST_S - 1.5)
  for (const slot of OFFICE.slots) {
    const w = tileToWorld(slot.seat.i, slot.seat.j)
    assert.ok(Math.hypot(w.x - CENTRE.x, w.z - CENTRE.z) < reach, `seat at ${slot.seat.i},${slot.seat.j} is never reached`)
  }
})

test('the construction: grows out from the middle, feet before heads, lands with a slam, and adds nothing once done', () => {
  assert.ok(near(easeOutBack(0), 0) && near(easeOutBack(1), 1))
  assert.ok(easeOutBack(0.8) > 1, 'a rising piece overshoots')
  assert.ok(easeOutBack(0.8) < 1.15, 'but not by much')
  // the jitter is integer arithmetic on the tile index, in 0..1, and never negative
  assert.equal(tileJitter(0, 0), 0)
  assert.equal(tileJitter(1, 0), 7 / 17)
  assert.ok(tileJitter(-3, 5) >= 0 && tileJitter(-3, 5) < 1)
  // the middle of the office comes first; the tallest thing on a tile comes after its floor
  const cx = CENTRE.x
  const cz = CENTRE.z
  const far = { x: cx + 10 * T, z: cz }
  assert.ok(buildDelay(cx, H_OFFICE, cz) < buildDelay(far.x, H_OFFICE, far.z))
  assert.ok(buildDelay(cx, H_OFFICE, cz) < buildDelay(cx, H_OFFICE + 120, cz), 'a wall top lags its foot')
  // a tile's floor lands `RISE` after it starts, and the overshoot is over by then
  const land = landTime(cx, cz, H_OFFICE)
  assert.ok(near(land, buildDelay(cx, H_OFFICE, cz) + BUILD.RISE))
  assert.ok(near(foldLift(cx, H_OFFICE, cz, land, BLAST_REST), 0))
  // before its turn a point sits the full drop below its place; early in its rise it is somewhere
  // between (by half way the slam has already carried it past); at rest exactly nothing
  const start = buildDelay(far.x, H_OFFICE, far.z)
  assert.equal(foldLift(far.x, H_OFFICE, far.z, 0, BLAST_REST), BUILD.DROP)
  const early = foldLift(far.x, H_OFFICE, far.z, start + BUILD.RISE * 0.2, BLAST_REST)
  assert.ok(early > 0 && early < BUILD.DROP)
  assert.ok(foldLift(far.x, H_OFFICE, far.z, start + BUILD.RISE * 0.8, BLAST_REST) < 0, 'the slam overshoots')
  assert.equal(foldLift(far.x, H_OFFICE, far.z, BUILD_REST, BLAST_REST), 0)
  assert.equal(foldLift(123.4, 77, 987.6, BUILD_REST, BLAST_REST), 0)
  // the whole island (radius about 1000) is up before the hats come off
  assert.ok(landTime(cx + 1000, cz, 0) + BUILD.LAG < BUILD.HAMMER_END)
  assert.ok(BUILD.HAMMER_END < BUILD_S)
  // the blast's sink: nothing ahead of the wave, the full drop well behind it
  assert.equal(foldLift(cx, H_OFFICE, cz, BUILD_REST, -1), 0)
  assert.equal(foldLift(cx, H_OFFICE, cz, BUILD_REST, 2000), BUILD.DROP)
  const front = foldLift(cx, H_OFFICE, cz, BUILD_REST, BLAST.SINK_LAG + BLAST.SINK_FRONT / 2 + 40)
  assert.ok(front > 0 && front < BUILD.DROP)
})

test('a hamster on the site drops in once its tile is there, works until the hats come off, and the camera work is transient', () => {
  const land = 1.0
  const before = builder(0, land)
  assert.ok(!before.here && !before.landed && before.working)
  const falling = builder(land + BUILD.LAND_AFTER - BUILD.FALL_S / 2, land)
  assert.ok(falling.here && !falling.landed && falling.height > 0 && falling.height < BUILD.FALL_H)
  const down = builder(land + BUILD.LAND_AFTER, land)
  assert.ok(down.landed && down.height === 0 && down.working)
  assert.ok(!builder(BUILD.HAMMER_END, land).working)
  // the build is watched from the story's view and is home before the hats come off; the blast cuts over under the flash and stays
  assert.equal(storyMix('build', 0), 1)
  assert.equal(storyMix('build', BUILD.CAM_AT + BUILD.CAM_S), 0)
  assert.ok(BUILD.CAM_AT + BUILD.CAM_S <= BUILD.HAMMER_END)
  assert.equal(storyMix('blast', 0), 0)
  assert.equal(storyMix('blast', BLAST.CAM_S), 1)
  assert.equal(storyMix('blast', BLAST_S), 1)
  assert.equal(storyMix('open', 3), 0)
  assert.equal(storyMix('closed', 3), 0)
  // a story cut short hands the next one the view it was showing: no snap back to the curve's start
  assert.equal(storyMix('blast', 0, 0.4), 0.4)
  assert.equal(storyMix('blast', BLAST.CAM_S, 0.4), 1)
  assert.equal(storyMix('build', 0, 0.4), 0.4)
  assert.equal(storyMix('build', BUILD.CAM_AT, 0.4), 0.4)
  assert.equal(storyMix('build', BUILD.CAM_AT + BUILD.CAM_S, 0.4), 0)
  // the story's frame: the deck and two tiles of sea around it, ground zero in the middle
  const sb = storyBounds()
  assert.ok(Math.abs((sb.minX + sb.maxX) / 2 - CENTRE.x) < 1e-6 && Math.abs((sb.minZ + sb.maxZ) / 2 - CENTRE.z) < 1e-6)
  assert.equal(sb.maxX - sb.minX, (OFFICE.W + 2 * STORY_MARGIN) * T)
  assert.equal(sb.maxZ - sb.minZ, (OFFICE.D + 2 * STORY_MARGIN) * T)
  // the story's zoom: a little wider than the view was, but never closer than the cap nor farther than the deck fit
  assert.equal(storyScale(2.8, 0.4), STORY_MAX_SCALE) // a close-up pulls out to the cap
  assert.equal(storyScale(1.6, 0.4), 1.6 * STORY_ZOOM_OUT) // a middling view, a little wider
  assert.equal(storyScale(0.5, 0.4), 0.4 * STORY_CLOSE) // an overview never goes farther than the deck fit
  // halfway between two views: the middle of the ground, the geometric mean of the zooms
  const half = blendView({ tx: 0, tz: 0, scale: 1 }, { tx: 100, tz: 50, scale: 4 }, 0.5)
  assert.equal(half.tx, 50)
  assert.equal(half.tz, 25)
  assert.ok(Math.abs(half.scale - 2) < 1e-9)
  assert.deepEqual(blendView({ tx: 0, tz: 0, scale: 1 }, { tx: 100, tz: 50, scale: 4 }, 0), { tx: 0, tz: 0, scale: 1 })
  // the pane: shut for the blast's last half second and while closed, open from the build's first frame
  assert.equal(paneShut('blast', BLAST_S - PANE_S - 0.01), false)
  assert.equal(paneShut('blast', BLAST_S - PANE_S), true)
  assert.equal(paneShut('closed', 0), true)
  assert.equal(paneShut('build', 0), false)
  assert.equal(paneShut('open', 0), false)
})
