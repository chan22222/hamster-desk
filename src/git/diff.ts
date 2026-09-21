// Reading a unified diff, one line at a time. Pure and dependency-free: `DiffView` paints with it
// and the unit test checks it, and neither should have to drag React or `node:child_process` in.

export type DiffLineKind = 'add' | 'del' | 'hunk' | 'meta' | 'ctx'

/** `diff --git`, `index`, `--- a/x`, `+++ b/x`, and the mode/rename lines: header, not content. */
const META = /^(diff |index |old mode|new mode|new file|deleted file|similarity |dissimilarity |rename |copy |Binary files |\\ No newline)/

/**
 * What one line of `git diff` output is.
 *
 * `---` / `+++` are checked before `-` / `+` on purpose: they start with the same character as a
 * removed and an added line, and colouring the file header red and green is the classic tell of a
 * diff viewer nobody bothered to finish.
 */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith('@@')) return 'hunk'
  if (line.startsWith('---') || line.startsWith('+++')) return 'meta'
  if (META.test(line)) return 'meta'
  if (line.startsWith('+')) return 'add'
  if (line.startsWith('-')) return 'del'
  return 'ctx'
}
