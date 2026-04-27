/**
 * Punto de entrada: carga `.env`, escucha el puerto e inicia la limpieza periódica Graph sobre `procesados`.
 */
import dotenv from 'dotenv';
import { createApp } from './createApp.js';
import { startAdQueueProcessedGraphCleanup } from './services/adQueueProcessedGraphCleanup.js';

dotenv.config();

const app = createApp();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  /** Retira usuarios temporales de Graph cuando el job de cola AD terminó con éxito. */
  startAdQueueProcessedGraphCleanup();
});

export default app;
