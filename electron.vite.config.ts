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
    build: { lib: { entry: resolve(__dirname, 'electron/preload.ts') } },
  },
  renderer: {
    root: 'src',
    plugins: [react()],
    build: { rollupOptions: { input: resolve(__dirname, 'src/index.html') } },
    resolve: { alias: { '@shared': resolve(__dirname, 'shared') } },
  },
})
