import { Fragment, type ReactNode } from 'react'

/**
 * A dictionary string with `<b>`, `<code>` or `<br>` in it → React nodes. Only those three, flat
 * (no nesting), so a translator can move the emphasis without touching JSX; anything else in the
 * string stays text, so a user's account name inside `<b>…</b>` cannot inject markup.
 */
export function rich(text: string): ReactNode {
  const parts = text.split(/(<b>[\s\S]*?<\/b>|<code>[\s\S]*?<\/code>|<br>)/)
  if (parts.length === 1) return text
  return parts.map((p, i) => {
    if (!p) return null
    if (p === '<br>') return <br key={i} />
    if (p.startsWith('<b>')) return <b key={i}>{p.slice(3, -4)}</b>
    if (p.startsWith('<code>')) return <code key={i}>{p.slice(6, -7)}</code>
    return <Fragment key={i}>{p}</Fragment>
  })
}
