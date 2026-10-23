import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/summary', requireAuth, asyncRoute(controller.summary));
router.get('/', requireAuth, asyncRoute(controller.list));
router.post('/', requireAuth, asyncRoute(controller.create));
router.patch('/:yieldId', requireAuth, asyncRoute(controller.update));

export default router;
