// The dictionaries, one per language code. `ko` is the source of truth (its shape is the type);
// the rest are typed against it, so a key missing from one language fails the build.

import type { Code } from './lang'
import { de } from './de'
import { en } from './en'
import { es } from './es'
import { fr } from './fr'
import { ja } from './ja'
import { ko, type UiStrings } from './ko'
import { pt } from './pt'
import { ru } from './ru'
import { zh } from './zh'

export type { UiStrings }
export * from './lang'

export const UI: Record<Code, UiStrings> = { ko, en, ja, zh, es, de, fr, pt, ru }

/** the strings of a language code (English for one we have none for) */
export function uiStringsOf(code: string): UiStrings {
  return (UI as Record<string, UiStrings>)[code] ?? en
}
