import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const projectRoot = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  main: { plugins: [externalizeDepsPlugin()] },
  preload: { plugins: [externalizeDepsPlugin()] },
  renderer: {
    build: {
      assetsInlineLimit: 0,
      rollupOptions: {
        input: {
          index: join(projectRoot, 'src/renderer/index.html')
        }
      }
    },
    server: {
      headers: {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp'
      }
    }
  }
})
