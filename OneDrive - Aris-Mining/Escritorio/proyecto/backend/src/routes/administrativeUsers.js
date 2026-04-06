import express from 'express';
import multer from 'multer';
import {
  createAdministrativeUser,
  createAdministrativeUsersBulk,
  getAdministrativeQueueRequestResult,
  getNextAdministrativeUsername,
  testAdQueueConnection,
} from '../controllers/administrativeUsersController.js';

const router = express.Router();
const upload = multer();

/**
 * POST /api/users/administrative/bulk
 * Carga masiva desde Excel (cola AD).
 */
router.post('/administrative/bulk', upload.single('file'), createAdministrativeUsersBulk);

/**
 * GET /api/users/administrative/queue-connection-test
 * Comprueba que el proceso Node pueda escribir en AD_QUEUE_UNC.
 */
router.get('/administrative/queue-connection-test', testAdQueueConnection);

/**
 * GET /api/users/administrative/next-username
 */
router.get('/administrative/next-username', getNextAdministrativeUsername);

/**
 * GET /api/users/administrative/queue-requests/:requestId/result
 */
router.get(
  '/administrative/queue-requests/:requestId/result',
  getAdministrativeQueueRequestResult
);

/**
 * POST /api/users/administrative — mismo comportamiento que POST /api/users (compatibilidad)
 */
router.post('/administrative', createAdministrativeUser);

export default router;
