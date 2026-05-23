/** Arranque del servidor: carga .env, API HTTP y tarea de limpieza en carpeta procesados. */
import dotenv from 'dotenv';
import { createApp } from './createApp.js';
import { startAdQueueProcessedGraphCleanup } from './services/adQueueProcessedGraphCleanup.js';
import { warmQueueSamUpnIndex } from './services/operationalAccountAvailability.js';
import { logUpnPrecheckConfigWarnings } from './config/adQueueConfig.js';

dotenv.config();
logUpnPrecheckConfigWarnings();

const app = createApp();
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en http://localhost:${PORT}`);
  startAdQueueProcessedGraphCleanup();

  warmQueueSamUpnIndex()
    .then(({ samCount, upnCount, displayNameCount, employeeIdCount }) => {
      console.log(
        `[Startup] Índice cola SMB listo (${samCount} sAM, ${upnCount} UPN/correo, ${displayNameCount} nombres en cola, ${employeeIdCount} cédulas).`
      );
    })
    .catch((err) => {
      console.warn(
        '[Startup] No se pudo precalentar índice cola SMB (AD_QUEUE_UNC). La primera alta operativa puede tardar más:',
        err?.message || err
      );
    });
});

export default app;
