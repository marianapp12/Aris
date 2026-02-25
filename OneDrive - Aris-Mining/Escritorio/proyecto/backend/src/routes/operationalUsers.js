import express from 'express';
import multer from 'multer';
import {
  createOperationalUser,
  getNextUsername,
  createOperationalUsersBulk,
} from '../controllers/operationalUsersController.js';

const router = express.Router();
const upload = multer();

/**
 * GET /api/users/next-username
 * Devuelve el siguiente nombre de usuario disponible (sin crear el usuario).
 */
router.get('/next-username', getNextUsername);

/**
 * POST /api/users/operational/bulk
 * Carga masiva de usuarios desde un archivo Excel.
 */
router.post('/operational/bulk', upload.single('file'), createOperationalUsersBulk);

/**
 * POST /api/users/operational
 * Crea un nuevo usuario operativo en Microsoft 365
 */
router.post('/operational', createOperationalUser);

export default router;
