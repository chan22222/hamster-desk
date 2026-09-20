// The one icon set for the whole chrome: 16×16 line icons drawn with `currentColor`, so a button
// only has to set a text colour. Inline SVG rather than a font — the CSP forbids remote fonts, and
// text glyphs (≡ ＋ ⌂ ✓) land at different sizes and baselines in every system family.
//
// The two emoji that stay emoji are product marks, not icons: 🐹 for the app and for a folder
// Claude Code knows about.

import type { ReactNode } from 'react'

export interface IconProps {
  size?: number
  className?: string
}

/** shared frame: everything is decorative, the label lives on the button */
function Svg({ size = 16, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function IconSidebar(p: IconProps) {
  return (
    <Svg {...p}>
      <rect x="2.25" y="3.25" width="11.5" height="9.5" rx="1.5" />
      <path d="M6.5 3.25v9.5" />
    </Svg>
  )
}

export function IconPlus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 3.5v9M3.5 8h9" />
    </Svg>
  )
}

export function IconMinus(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.5 8h9" />
    </Svg>
  )
}

export function IconClose(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </Svg>
  )
}

export function IconHome(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.75 7.1 8 2.75l5.25 4.35v5.65a.5.5 0 0 1-.5.5h-9.5a.5.5 0 0 1-.5-.5z" />
    </Svg>
  )
}

export function IconCheck(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.25 8.4 6.4 11.6l6.35-7.2" />
    </Svg>
  )
}

const STAR = 'M8 2.4l1.76 3.57 3.94.57-2.85 2.78.67 3.93L8 11.39l-3.52 1.86.67-3.93L2.3 6.54l3.94-.57z'

export function IconStar({ filled, ...p }: IconProps & { filled?: boolean }) {
  return (
    <Svg {...p}>
      <path d={STAR} fill={filled ? 'currentColor' : 'none'} />
    </Svg>
  )
}

export function IconSearch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="7" cy="7" r="4.25" />
      <path d="M10.2 10.2 13.5 13.5" />
    </Svg>
  )
}

export function IconFolder(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M2.25 12.5v-8.6a.65.65 0 0 1 .65-.65h3.3l1.5 1.75h5.65a.65.65 0 0 1 .65.65v6.85a.65.65 0 0 1-.65.65H2.9a.65.65 0 0 1-.65-.65z" />
    </Svg>
  )
}

export function IconFile(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M3.75 2.75h5l3.5 3.5v7h-8.5z" />
      <path d="M8.75 2.75v3.5h3.5" />
    </Svg>
  )
}

const CHEVRON_ROT: Record<string, number> = { right: 0, down: 90, left: 180, up: 270 }

export function IconChevron({ dir = 'right', ...p }: IconProps & { dir?: 'up' | 'down' | 'left' | 'right' }) {
  return (
    <Svg {...p}>
      <path d="M6.25 3.5 10.5 8l-4.25 4.5" transform={`rotate(${CHEVRON_ROT[dir] ?? 0} 8 8)`} />
    </Svg>
  )
}

export function IconMore(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="3.6" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="8" cy="8" r="1.05" fill="currentColor" stroke="none" />
      <circle cx="12.4" cy="8" r="1.05" fill="currentColor" stroke="none" />
    </Svg>
  )
}

export function IconTarget(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="8" cy="8" r="3.9" />
      <path d="M8 1.6v2.2M8 12.2v2.2M1.6 8h2.2M12.2 8h2.2" />
    </Svg>
  )
}

export function IconMap(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M5.9 2.75 2.25 4.3v8.95L5.9 11.7l4.2 1.55 3.65-1.55V2.75L10.1 4.3z" />
      <path d="M5.9 2.75V11.7M10.1 4.3v8.95" />
    </Svg>
  )
}

export function IconExternal(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M9.25 2.75h4v4M13.25 2.75 7.5 8.5" />
      <path d="M12.25 9.5v2.9a.85.85 0 0 1-.85.85H3.6a.85.85 0 0 1-.85-.85V4.6a.85.85 0 0 1 .85-.85h2.9" />
    </Svg>
  )
}

export function IconRefresh(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M13.1 8a5.1 5.1 0 1 1-1.55-3.67" />
      <path d="M13.4 2.2v3.2h-3.2" />
    </Svg>
  )
}

export function IconDownload(p: IconProps) {
  return (
    <Svg {...p}>
      <path d="M8 2.6v7.6M4.8 7.2 8 10.4l3.2-3.2" />
      <path d="M2.9 13.1h10.2" />
    </Svg>
  )
}

/** the `⎇` a git folder used to wear */
export function IconBranch(p: IconProps) {
  return (
    <Svg {...p}>
      <circle cx="4.75" cy="3.6" r="1.7" />
      <circle cx="4.75" cy="12.4" r="1.7" />
      <circle cx="11.5" cy="3.6" r="1.7" />
      <path d="M4.75 5.3v5.4" />
      <path d="M11.5 5.3v1.15a2.3 2.3 0 0 1-2.3 2.3H7.05a2.3 2.3 0 0 0-2.3 2.3" />
    </Svg>
  )
}
