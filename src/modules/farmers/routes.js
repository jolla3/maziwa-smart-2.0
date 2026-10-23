import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

router.get('/me', requireAuth, asyncRoute(controller.me));
router.get('/:farmerProfileId', requireAuth, asyncRoute(controller.getOne));

export default router;
