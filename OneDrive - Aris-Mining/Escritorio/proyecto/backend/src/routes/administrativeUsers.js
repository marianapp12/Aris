import express from 'express';
import {
  createAdministrativeUser,
  getNextAdministrativeUsername,
  getAdministrativeUserJob,
} from '../controllers/administrativeUsersController.js';

const router = express.Router();

/**
 * GET /api/users/administrative/jobs/:jobId
 */
router.get('/administrative/jobs/:jobId', getAdministrativeUserJob);

/**
 * GET /api/users/administrative/next-username
 */
router.get('/administrative/next-username', getNextAdministrativeUsername);

/**
 * POST /api/users/administrative — 202 + jobId (PowerShell / AD remoto)
 */
router.post('/administrative', createAdministrativeUser);

export default router;
