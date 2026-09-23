// What a notification is about, and the marks that say so. Shared by the popup window's page
// (src/toast/toast.ts, plain DOM) and the in-app banner that stands in for it (Banner.tsx), so the
// two can never disagree about which kind is which colour.
//
// Three kinds, not two: a permission request and a question both wait for the user, but only the
// first one is Claude Code asking to *do* something, and it used to wear the same amber as a
// question. The colour is never the only cue — the title says the kind in words, and each kind has
// its own icon shape.
//
// The icons are stroke paths in the icon set's own frame (16×16, 1.5 stroke, round caps,
// currentColor — src/widgets/icons.tsx): the popup page has no React to render that file with, so
// both sides draw these paths themselves.

import type { NotifyRequest } from '../../shared/events'

export type NotifyKind = 'permission' | 'question' | 'done'

export const kindOf = (tag: NotifyRequest['tag']): NotifyKind => (tag === 'turn' ? 'done' : tag === 'permission' ? 'permission' : 'question')

/** a padlock for "may I?", a circled question mark for "which one?", a tick for "done" */
export const KIND_PATHS: Record<NotifyKind, readonly string[]> = {
  permission: [
    'M4.95 7.25h6.1a1.2 1.2 0 0 1 1.2 1.2v3.35a1.2 1.2 0 0 1-1.2 1.2h-6.1a1.2 1.2 0 0 1-1.2-1.2V8.45a1.2 1.2 0 0 1 1.2-1.2z',
    'M5.6 7.25V5.6a2.4 2.4 0 0 1 4.8 0v1.65',
    'M8 9.55v1.3',
  ],
  question: [
    'M8 2.25a5.75 5.75 0 1 1 0 11.5a5.75 5.75 0 1 1 0-11.5z',
    'M6.2 6.3a1.8 1.8 0 1 1 3.07 1.27C8.77 8.07 8 8.55 8 9.35',
    'M8 11.4v.01',
  ],
  done: ['M3.25 8.4 6.4 11.6l6.35-7.2'],
}

/** the card's two controls: "go there" and "dismiss" — the same strokes as IconChevron and IconClose */
export const GO_PATHS: readonly string[] = ['M6.25 3.5 10.5 8l-4.25 4.5']
export const CLOSE_PATHS: readonly string[] = ['M4 4l8 8M12 4l-8 8']
