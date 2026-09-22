// Model-dependent looks. New model ids get a sensible skin without a code change: the family is
// matched by substring, the generation is read from the id for the badge, and an unknown family
// falls back to a fur colour derived from the id's hash.
/** Head-mounted extras a model's skin can wear. */
export type Accessory = 'glasses' | 'beret' | 'headphones' | 'leaf'

export type SkinAccessory = Accessory | 'none'

export interface Skin {
  family: string
  label: string
  /** palette overrides (char → colour) applied to the hamster's fur channels */
  colors: Record<string, string>
  accessory: SkinAccessory
  /** colour for the badge under the name */
  badge: string
}

const FAMILIES: { re: RegExp; family: string; colors: Record<string, string>; accessory: SkinAccessory; badge: string }[] = [
  // a beret, not a crown: the crown read as "the boss", and with Fable the default model every
  // hamster in the room wore one. The boss is told apart by its suit (hamster.ts), whatever it runs.
  { re: /fable|mythos/i, family: 'Fable', colors: {}, accessory: 'beret', badge: '#e9b872' },
  { re: /opus/i, family: 'Opus', colors: { f: '#d9a26b', d: '#a8662d', o: '#3c2014' }, accessory: 'glasses', badge: '#c98a45' },
  { re: /sonnet/i, family: 'Sonnet', colors: { f: '#efe0cc', d: '#c7ad8e', o: '#4a3a2c' }, accessory: 'headphones', badge: '#b9a58e' },
  { re: /haiku/i, family: 'Haiku', colors: { f: '#e9e9f2', d: '#bfc2d6', o: '#3f4256' }, accessory: 'leaf', badge: '#9aa3c7' },
]

function hashHue(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

function generationOf(id: string): string {
  // claude-fable-5-1 → 5.1, claude-opus-5 → 5, claude-haiku-4-5-20251001 → 4.5
  const m = id.match(/(?:fable|mythos|opus|sonnet|haiku)-(\d+)(?:-(\d+))?/i)
  if (!m) return ''
  return m[2] && m[2].length <= 2 ? `${m[1]}.${m[2]}` : m[1]
}

const cache = new Map<string, Skin>()

export function modelSkin(modelId: string | null): Skin {
  const id = modelId ?? ''
  const hit = cache.get(id)
  if (hit) return hit
  let skin: Skin
  const fam = FAMILIES.find((f) => f.re.test(id))
  if (fam) {
    const gen = generationOf(id)
    skin = { family: fam.family, label: gen ? `${fam.family} ${gen}` : fam.family, colors: fam.colors, accessory: fam.accessory, badge: fam.badge }
  } else if (!id) {
    skin = { family: '', label: '', colors: {}, accessory: 'none', badge: '#7f88a8' }
  } else {
    const hue = hashHue(id)
    skin = {
      family: id,
      label: id.replace(/^claude-/, '').slice(0, 18),
      colors: { f: `hsl(${hue} 55% 78%)`, d: `hsl(${hue} 50% 55%)` },
      accessory: 'none',
      badge: `hsl(${hue} 60% 70%)`,
    }
  }
  cache.set(id, skin)
  return skin
}
