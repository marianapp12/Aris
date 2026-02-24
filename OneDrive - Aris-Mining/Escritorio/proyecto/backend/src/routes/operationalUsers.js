import express from 'express';
import { createOperationalUser } from '../controllers/operationalUsersController.js';

const router = express.Router();

/**
 * POST /api/users/operational
 * Crea un nuevo usuario operativo en Microsoft 365
 */
router.post('/operational', createOperationalUser);

export default router;
