import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/summary', requireAuth, asyncRoute(controller.summary));
router.get('/', requireAuth, asyncRoute(controller.list));
router.post('/', requireAuth, asyncRoute(controller.create));
router.patch('/:entryId', requireAuth, asyncRoute(controller.update));
router.post('/:entryId/void', requireAuth, asyncRoute(controller.voidEntry));

export default router;
