/**
 * Aplicación Express sin escuchar puerto (útil para tests con supertest y para reutilizar middleware).
 */
import express from 'express';
import cors from 'cors';
import operationalUsersRoutes from './routes/operationalUsers.js';
import queueUsersRoutes from './routes/queueUsers.js';
import administrativeUsersRoutes from './routes/administrativeUsers.js';

export function createApp() {
  const app = express();

  const corsOrigin = process.env.CORS_ORIGIN?.trim();
  app.use(corsOrigin ? cors({ origin: corsOrigin }) : cors());

  /** Límite bajo para evitar payloads enormes en APIs de usuario. */
  app.use(express.json({ limit: '128kb' }));

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', message: 'Servidor funcionando correctamente' });
  });

  app.use('/api/users', operationalUsersRoutes);
  app.use('/api/users', queueUsersRoutes);
  app.use('/api/users', administrativeUsersRoutes);

  /** Middleware de error Express (cuatro argumentos); en desarrollo adjunta stack. */
  app.use((err, req, res, next) => {
    const statusFromErr = Number(err.status ?? err.statusCode);
    const httpStatus =
      Number.isFinite(statusFromErr) && statusFromErr >= 400 ? statusFromErr : 500;

    /** Cuerpo demasiado grande: respuesta 413 correcta; no spamear stderr ni logs en producción. */
    const isPayloadTooLarge =
      httpStatus === 413 ||
      err.type === 'entity.too.large' ||
      err.name === 'PayloadTooLargeError';

    if (!isPayloadTooLarge) {
      console.error('Error:', err);
    }

    res.status(httpStatus).json({
      error: err.message || 'Error interno del servidor',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });

  return app;
}
