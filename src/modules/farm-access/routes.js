import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/permissions', requireAuth, asyncRoute(controller.catalog));
router.get('/grants', requireAuth, asyncRoute(controller.listMine));
router.post('/grants', requireAuth, asyncRoute(controller.grant));
router.post('/grants/:grantId/revoke', requireAuth, asyncRoute(controller.revoke));

export default router;
