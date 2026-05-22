import express from 'express';
import multer from 'multer';
import {
  createOperationalUser,
  getNextUsername,
  createOperationalUsersBulk,
} from '../controllers/operationalUsersController.js';
import { checkExistingPerson } from '../controllers/personExistsController.js';

const router = express.Router();
const upload = multer();

/**
 * POST /api/users/check-existing-person
 * Comprueba si el nombre y apellidos ya existen en Microsoft 365 o Active Directory.
 */
router.post('/check-existing-person', checkExistingPerson);

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
