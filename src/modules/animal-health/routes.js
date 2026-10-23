import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/', requireAuth, asyncRoute(controller.list));
router.post('/', requireAuth, asyncRoute(controller.create));
router.patch('/:recordId', requireAuth, asyncRoute(controller.update));

export default router;
