import express from 'express';
import { createUserViaAdQueue } from '../controllers/administrativeUsersController.js';

const router = express.Router();

/**
 * POST /api/users — encola creación corporativa AD (archivo JSON en UNC)
 */
router.post('/', createUserViaAdQueue);

export default router;
