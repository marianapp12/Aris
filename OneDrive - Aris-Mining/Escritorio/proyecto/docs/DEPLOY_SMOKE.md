# Smoke post-despliegue

Comprobaciones rápidas tras publicar backend y frontend. Orden sugerido.

## Infraestructura

- [ ] **Node:** versión alineada con [.nvmrc](../.nvmrc) en el servidor y en CI.
- [ ] **Healthcheck** del balanceador o contenedor apuntando a `GET /health` del API.
- [ ] **CORS:** en producción definir `CORS_ORIGIN` con el origen público del front (p. ej. `https://app.ejemplo.com`). Si no se define, el servidor mantiene CORS permisivo (`cors()`), útil solo en desarrollo.
- [ ] **Frontend:** `VITE_API_BASE_URL` en el build apunta al API público (u origen + path detrás del mismo host); no depender del proxy de Vite de desarrollo.

## Llamadas HTTP (smoke)

1. `GET /health` → `200`, cuerpo `{ "status": "ok", ... }`.
2. Si usáis cola AD: `GET /api/users/administrative/queue-connection-test`.
3. `GET /api/users/administrative/next-username?givenName=Juan&surname1=Perez` → `400` si nombres cortos (validación); con configuración completa → `200` o error de negocio esperado.
4. `GET /api/users/next-username?...` → solo si Graph está configurado en ese entorno.
5. **Sin efectos secundarios:** `POST /api/users` y `POST /api/users/operational` con cuerpo inválido `{}` → `400` (solo validación).

## Opcional

- E2E (p. ej. Playwright) con usuario de prueba en Entra ID contra la URL publicada, incluyendo login MSAL.
