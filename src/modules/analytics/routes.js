import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/dashboard', requireAuth, asyncRoute(controller.dashboard));
router.get('/herd', requireAuth, asyncRoute(controller.herdSummary));
router.get('/milk', requireAuth, asyncRoute(controller.milkTrends));
router.get('/finance', requireAuth, asyncRoute(controller.financeSummary));

export default router;
