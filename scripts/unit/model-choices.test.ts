import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODEL_CHOICES, modelAliasOf } from '../../src/session/models'
import { modelSkin } from '../../src/desk/skins'

test('the bar offers exactly the four family aliases the CLI accepts, most capable first', () => {
  assert.deepEqual(
    MODEL_CHOICES.map((c) => c.alias),
    ['fable', 'opus', 'sonnet', 'haiku'],
  )
})

test('every alias resolves to an id the skins know, so the menu never shows a hashed fallback label', () => {
  // Claude Code 2.1.278 `latest_per_family`; the labels are what the bar and the menu both show
  assert.deepEqual(
    MODEL_CHOICES.map((c) => [c.id, modelSkin(c.id).label]),
    [
      ['claude-fable-5-1', 'Fable 5.1'],
      ['claude-opus-5', 'Opus 5'],
      ['claude-sonnet-5', 'Sonnet 5'],
      ['claude-haiku-4-5', 'Haiku 4.5'],
    ],
  )
  for (const c of MODEL_CHOICES) assert.equal(modelSkin(c.id).family.toLowerCase(), c.alias, `${c.alias} wears its own family's skin`)
})

test('modelAliasOf ticks the family of a dated id and of an older generation', () => {
  assert.equal(modelAliasOf('claude-haiku-4-5-20251001'), 'haiku')
  assert.equal(modelAliasOf('claude-opus-4-8'), 'opus')
  assert.equal(modelAliasOf('claude-sonnet-5'), 'sonnet')
  assert.equal(modelAliasOf('claude-fable-5-1'), 'fable')
  assert.equal(modelAliasOf('CLAUDE-OPUS-5'), 'opus', 'case does not matter, as in the CLI')
})

test('modelAliasOf ticks nothing for no model or a model outside the four families', () => {
  assert.equal(modelAliasOf(null), null)
  assert.equal(modelAliasOf(''), null)
  // wears the Fable skin, but `/model fable` would not keep it
  assert.equal(modelAliasOf('claude-mythos-5-1'), null)
  assert.equal(modelSkin('claude-mythos-5-1').family, 'Fable')
})
