import { defineConfig } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import basicSsl from '@vitejs/plugin-basic-ssl'

export default defineConfig({
  plugins: [svelte(), basicSsl()],
  optimizeDeps: {
    exclude: ['@mtcute/wasm'],
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
})
