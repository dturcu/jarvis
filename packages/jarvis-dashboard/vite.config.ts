import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  root: __dirname,
  plugins: [react(), tailwindcss()],
  server: {
    port: 4243,
    proxy: {
      '/api': {
        target: 'http://localhost:4242',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = process.env.JARVIS_API_TOKEN ?? ''
            if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`)
          })
        }
      },
      '/portal/api': { target: 'http://localhost:4242' }
    }
  },
  preview: {
    port: 4250,
    proxy: {
      '/api': {
        target: 'http://localhost:4242',
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            const token = process.env.JARVIS_API_TOKEN ?? ''
            if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`)
          })
        }
      },
      '/portal/api': { target: 'http://localhost:4242' }
    }
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
})
