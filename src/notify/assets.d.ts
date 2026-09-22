// Vite's asset imports, typed. The project does not pull in `vite/client` (tsconfig `types` is
// node only), so the two assets the renderer imports get their declarations here: the notifier's
// sound and the Spritfy logo the studio hangs on the wall (src/desk/signs.ts).
declare module '*.wav?url' {
  const src: string
  export default src
}
/** `?inline` = a data: URL, whatever the size — see signs.ts for why the logo needs that */
declare module '*.png?inline' {
  const src: string
  export default src
}
