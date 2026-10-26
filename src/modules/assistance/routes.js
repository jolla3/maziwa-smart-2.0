import express from 'express';
import * as controller from './controller.js';

const router = express.Router();
const asyncRoute = (h) => (req, res, next) => Promise.resolve(h(req, res, next)).catch(next);

router.post('/message', asyncRoute(controller.postMessage));

export default router;
