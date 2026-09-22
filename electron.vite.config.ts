import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import { execFileSync } from 'node:child_process'

/** the commit being built, for electron/app-update.ts to compare with GitHub; '' outside a checkout */
function buildCommit(): string {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: __dirname, encoding: 'utf8', windowsHide: true }).trim()
  } catch {
    return ''
  }
}

export default defineConfig({
  main: {
    define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: resolve(__dirname, 'electron/main.ts') } },
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    // the notification window has a preload of its own (electron/toast-preload.ts): it must not
    // be handed the app's whole bridge
    build: {
      lib: { entry: { preload: resolve(__dirname, 'electron/preload.ts'), 'toast-preload': resolve(__dirname, 'electron/toast-preload.ts') } },
    },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    // two pages: the app, and the notification window's (src/toast/, served at /toast/toast.html
    // in dev and out/renderer/toast/toast.html when built)
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/index.html'), toast: resolve(__dirname, 'src/toast/toast.html') } } },
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  },
})
