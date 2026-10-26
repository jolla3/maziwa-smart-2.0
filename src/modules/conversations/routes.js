import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/', requireAuth, asyncRoute(controller.list));
router.post('/', requireAuth, asyncRoute(controller.create));
router.get('/:id', requireAuth, asyncRoute(controller.getOne));
router.get('/:id/messages', requireAuth, asyncRoute(controller.listMessages));
router.post('/:id/messages', requireAuth, asyncRoute(controller.sendMessage));
router.post('/:id/read', requireAuth, asyncRoute(controller.markRead));

export default router;
