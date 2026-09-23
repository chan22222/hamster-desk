// What reaches the shell when text is pasted into a terminal or files are dropped on it. These are
// the Windows Terminal rules, kept pure so they can be tested without an xterm. Owner: B.
//
// xterm 6 wraps a paste in ESC[200~ … ESC[201~ (bracketed paste) but does nothing about an
// ESC[201~ *inside* the text: a clipboard holding one ends the paste early, and whatever follows
// (a command and a carriage return) reaches the shell as if it had been typed. Windows Terminal
// strips every C0 and C1 control except tab and the line breaks before it pastes
// (`FilterStringForPaste`), and so does this. The bracket markers are taken out whole first, so
// they don't leave a stray `[201~` behind.

const BRACKET_MARKER = /\x1b\[20[01]~/g
/** C0 except tab, LF and CR; DEL; C1 */
const CONTROL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f]/g

/** Pasted text, as it may be handed to `term.paste`. */
export function sanitizePaste(text: string): string {
  return text.replace(BRACKET_MARKER, '').replace(CONTROL, '')
}

/**
 * Dropped files, the way Windows Terminal types them: full paths joined by spaces, each wrapped in
 * double quotes when it holds a space. Both PowerShell and cmd read that as one argument.
 */
export function pathsForPaste(paths: string[]): string {
  return paths
    .filter((p) => p.length > 0)
    .map((p) => (p.includes(' ') ? `"${p}"` : p))
    .join(' ')
}
