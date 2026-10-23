import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import { makeUploader } from '../../integrations/media-storage/uploader.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);
const upload = makeUploader('listings', { imageOnly: true, maxFiles: 10 });

// Public browse
router.get('/', asyncRoute(controller.listPublic));

// Authenticated seller routes BEFORE /:adId
router.get('/me/listings', requireAuth, asyncRoute(controller.listMine));
router.post('/', requireAuth, upload.array('images', 10), asyncRoute(controller.create));

// Public detail + views
router.get('/:adId', asyncRoute(controller.getPublic));
router.post('/:adId/views', asyncRoute(controller.recordView));

// Authenticated mutations
router.patch('/:adId', requireAuth, upload.array('images', 10), asyncRoute(controller.update));
router.post('/:adId/archive', requireAuth, asyncRoute(controller.archive));

export default router;
