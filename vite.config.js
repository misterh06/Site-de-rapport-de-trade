import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  base: '/Site-de-rapport-de-trade/',
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pea: resolve(__dirname, 'pea.html'),
      },
    },
  },
})