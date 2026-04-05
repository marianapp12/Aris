import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import operationalUsersRoutes from './routes/operationalUsers.js';
import queueUsersRoutes from './routes/queueUsers.js';
import administrativeUsersRoutes from './routes/administrativeUsers.js';

// Cargar variables de entorno
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '128kb' }));

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', message: 'Servidor funcionando correctamente' });
});

// API REST: todos los endpoints de usuarios bajo /api/users (p. ej. POST /api/users/operational).
// Rutas
app.use('/api/users', operationalUsersRoutes);
app.use('/api/users', queueUsersRoutes);
app.use('/api/users', administrativeUsersRoutes);

// Manejo de errores
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(err.status || 500).json({
    error: err.message || 'Error interno del servidor',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
});

export default app;
