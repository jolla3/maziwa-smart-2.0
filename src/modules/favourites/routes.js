import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/', requireAuth, asyncRoute(controller.list));
router.put('/:livestockAdId', requireAuth, asyncRoute(controller.save));
router.delete('/:livestockAdId', requireAuth, asyncRoute(controller.remove));

export default router;
