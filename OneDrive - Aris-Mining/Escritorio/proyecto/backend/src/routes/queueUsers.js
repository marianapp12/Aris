import express from 'express';
import { createUserViaAdQueue } from '../controllers/administrativeUsersController.js';

const router = express.Router();

router.post('/', createUserViaAdQueue);

export default router;
