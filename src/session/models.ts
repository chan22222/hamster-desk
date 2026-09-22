// The models the session bar offers. `/model` takes a full id or an alias, and an alias means
// "the newest model of that family", so the bar offers the family aliases and lets Claude Code
// resolve them — a new generation then needs no change here.
//
// Read from the CLI itself (2.1.278, `grep -a` on the binary), not from memory. It accepts
// `sonnet · opus · haiku · fable · best · sonnet[1m] · opus[1m] · fable[1m] · opusplan`, and its
// `latest_per_family` table says what each family resolves to today. Three are left out on purpose:
//   - `best` is whatever the account tier's default is (fable today); the bar could not tell
//     "default" from "fable" when ticking the current one.
//   - the `[1m]` variants are entitlement-gated — the CLI checks the account before offering them.
//   - `opusplan` is a mode, not a model (Opus while planning, Sonnet otherwise): the transcript and
//     the status line report the model actually used, so a tick on it could never be honest.
// `/model opusplan` typed in the terminal still works.
//
// The one-line description of each family (the CLI's own `/model` picker wording) is worded by the
// UI in its language: `ui().session.modelHints[alias]` (shared/i18n), read where the menu renders.

export type ModelAlias = 'fable' | 'opus' | 'sonnet' | 'haiku'

export interface ModelChoice {
  /** what `/model <alias>` is given; also the key of its hint in `session.modelHints` */
  alias: ModelAlias
  /**
   * The id the alias resolves to in Claude Code 2.1.278 (`latest_per_family`). The bar shows this
   * one the moment the user picks it, until the transcript or the status line reports what the CLI
   * really switched to — an org restriction can make that a different model.
   */
  id: string
}

export const MODEL_CHOICES: ModelChoice[] = [
  { alias: 'fable', id: 'claude-fable-5-1' },
  { alias: 'opus', id: 'claude-opus-5' },
  { alias: 'sonnet', id: 'claude-sonnet-5' },
  { alias: 'haiku', id: 'claude-haiku-4-5' },
]

/**
 * The alias a model id belongs to, decided the way the CLI decides it (the family name the id
 * contains), so a dated id (`claude-haiku-4-5-20251001`) and an older generation (`claude-opus-4-8`)
 * both tick their family. Null for an id outside the four families — `claude-mythos-5-1` wears the
 * Fable skin (skins.ts) but is not what `/model fable` would give.
 */
export function modelAliasOf(modelId: string | null): ModelAlias | null {
  if (!modelId) return null
  const id = modelId.toLowerCase()
  return MODEL_CHOICES.find((c) => id.includes(c.alias))?.alias ?? null
}
