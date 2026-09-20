import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: resolve('src'),
  plugins: [react()],
  resolve: { alias: { '@shared': resolve('shared') } },
  server: { host: '127.0.0.1', port: 5186, strictPort: true },
})
