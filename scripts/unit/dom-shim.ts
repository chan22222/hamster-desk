// The store is renderer code: it reads `window.desk` while the module is still being evaluated
// (to decide whether settings come from ui.json or from localStorage). Node has no `window`, so
// a test that imports it has to put an empty one there *before* the import — hence this module,
// which the tests list first. Everything else the store touches (localStorage, navigator) is
// already behind try/catch or a function.

const g = globalThis as unknown as Record<string, unknown>
if (!g.window) g.window = {}

export {}
