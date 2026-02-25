import express from 'express';
import { createOperationalUser, getNextUsername } from '../controllers/operationalUsersController.js';

const router = express.Router();

/**
 * GET /api/users/next-username
 * Devuelve el siguiente nombre de usuario disponible (sin crear el usuario).
 */
router.get('/next-username', getNextUsername);

/**
 * POST /api/users/operational
 * Crea un nuevo usuario operativo en Microsoft 365
 */
router.post('/operational', createOperationalUser);

export default router;
