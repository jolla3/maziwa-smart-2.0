import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/me', requireAuth, asyncRoute(controller.me));
router.post('/me', requireAuth, asyncRoute(controller.ensure));
router.post('/:sellerProfileId/verification', requireAuth, asyncRoute(controller.setStatus));

export default router;
