import { defineConfig, createLogger } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = 'http://localhost:5000'

function errnoFromUnknown(err: unknown): string {
  if (!err || typeof err !== 'object') return ''
  const e = err as NodeJS.ErrnoException & { errors?: unknown[] }
  if (typeof e.code === 'string' && e.code) return e.code
  if (e.name === 'AggregateError' && Array.isArray(e.errors)) {
    for (const sub of e.errors) {
      const c = errnoFromUnknown(sub)
      if (c) return c
    }
  }
  return ''
}

/** Errores habituales cuando el backend no está levantado (evita stack duplicado de Vite). */
function isBenignApiProxyLog(msg: string, options?: { error?: unknown }): boolean {
  if (!msg.includes('http proxy error:')) return false
  if (/ECONNREFUSED|ECONNRESET|ETIMEDOUT|read ECONNRESET/.test(msg)) return true
  const code = errnoFromUnknown(options?.error ?? null)
  return code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'ETIMEDOUT'
}

/** Un solo bloque legible cuando /api no puede conectar al backend. */
function logApiProxyConnectionHint(err: NodeJS.ErrnoException, req?: { url?: string }) {
  const path = req?.url ?? ''
  const code = err?.code ?? errnoFromUnknown(err)
  const label = path ? `${path}` : '/api'
  console.error(
    [
      '',
      '  ┌─────────────────────────────────────────────────────────────────',
      `  │  [proxy /api] Sin conexión con el backend  (${code || err?.message || 'error'})`,
      `  │  Ruta: ${label}`,
      '  │',
      `  │  Levante el API en ${API_TARGET}`,
      '  │  Desde la raíz del monorepo:',
      '  │    npm run dev:backend',
      '  └─────────────────────────────────────────────────────────────────',
      '',
    ].join('\n')
  )
}

function createDevLogger() {
  const logger = createLogger()
  const origError = logger.error.bind(logger)
  logger.error = (msg: string, options?: LogErrorOptions) => {
    if (isBenignApiProxyLog(msg, options)) return
    origError(msg, options)
  }
  return logger
}

// https://vitejs.dev/config/
export default defineConfig({
  customLogger: createDevLogger(),
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('error', (err: NodeJS.ErrnoException, req) => {
            const code = err?.code ?? ''
            if (code === 'ECONNRESET' || code === 'ECONNREFUSED' || code === 'ETIMEDOUT') {
              logApiProxyConnectionHint(err, req)
              return
            }
            console.error(`[vite proxy /api]${req?.url ? ` ${req.url}` : ''} → ${err.message}`)
          })
        },
      },
    },
  },
})
