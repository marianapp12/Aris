/**
 * Punto de entrada Express: CORS, JSON acotado, montaje de rutas `/api/users/*`, health y limpieza periódica de jobs Graph tras cola AD.
 */
import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import operationalUsersRoutes from './routes/operationalUsers.js';
import queueUsersRoutes from './routes/queueUsers.js';
import administrativeUsersRoutes from './routes/administrativeUsers.js';
import { startAdQueueProcessedGraphCleanup } from './services/adQueueProcessedGraphCleanup.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
/** Límite bajo para evitar payloads enormes en APIs de usuario. */
app.use(express.json({ limit: '128kb' }));

app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor funcionando correctamente' });
});

// API REST bajo /api/users (operativo Graph, cola legacy, administrativo UNC).
app.use('/api/users', operationalUsersRoutes);
app.use('/api/users', queueUsersRoutes);
app.use('/api/users', administrativeUsersRoutes);

/** Middleware de error Express (cuatro argumentos); en desarrollo adjunta stack. */
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  /** Retira usuarios temporales de Graph cuando el job de cola AD terminó con éxito. */
  startAdQueueProcessedGraphCleanup();
});

export default app;
