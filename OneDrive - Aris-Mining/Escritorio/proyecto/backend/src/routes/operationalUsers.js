import express from 'express';
import multer from 'multer';
import {
  createOperationalUser,
  getNextUsername,
  createOperationalUsersBulk,
} from '../controllers/operationalUsersController.js';
import { checkExistingPerson } from '../controllers/personExistsController.js';
import { precheckOperationalBulk } from '../controllers/bulkPrecheckController.js';

const router = express.Router();
const upload = multer();

router.post('/check-existing-person', checkExistingPerson);
router.get('/next-username', getNextUsername);
router.post('/operational/bulk-precheck', upload.single('file'), precheckOperationalBulk);
router.post('/operational/bulk', upload.single('file'), createOperationalUsersBulk);
router.post('/operational', createOperationalUser);

export default router;
