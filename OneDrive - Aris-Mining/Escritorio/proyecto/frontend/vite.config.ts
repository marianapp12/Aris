import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Log claro cuando el proxy /api no puede hablar con el backend (puerto 5000). */
function logApiProxyError(err: NodeJS.ErrnoException, req?: { url?: string }) {
  const path = req?.url ?? ''
  const code = err?.code ?? ''
  const base = `[vite proxy /api]${path ? ` ${path}` : ''} → ${err.message}${code ? ` (${code})` : ''}`
  if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
    console.error(
      `${base} — Levante el API en http://localhost:5000 (desde la raíz del monorepo: npm run dev:backend).`
    )
    return
  }
  console.error(base)
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (err: NodeJS.ErrnoException, req) => {
            logApiProxyError(err, req)
          })
        },
      },
    },
  },
})
