import express from 'express';
import { requireAuth } from '../../shared/middleware/requireAuth.js';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.get('/definitions', requireAuth, asyncRoute(controller.listDefinitions));
router.post('/definitions', requireAuth, asyncRoute(controller.createDefinition));
router.get('/definitions/:definitionId', requireAuth, asyncRoute(controller.getDefinition));
router.patch('/definitions/:definitionId', requireAuth, asyncRoute(controller.updateDefinition));

router.get('/entries', requireAuth, asyncRoute(controller.listEntries));
router.post('/entries', requireAuth, asyncRoute(controller.createEntry));
router.get('/entries/:entryId', requireAuth, asyncRoute(controller.getEntry));
router.patch('/entries/:entryId', requireAuth, asyncRoute(controller.updateEntry));

export default router;
