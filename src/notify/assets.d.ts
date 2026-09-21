// Vite's `?url` imports, typed. The project does not pull in `vite/client` (tsconfig `types` is
// node only), so the one asset the notifier loads gets its declaration here.
declare module '*.wav?url' {
  const src: string
  export default src
}
