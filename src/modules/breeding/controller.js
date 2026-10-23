import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function create(req, res) {
  try {
    const event = await service.createEvent(req.account, req.body || {});
    return apiResponse.success(res, { event }, 'Breeding event recorded', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function list(req, res) {
  try {
    const events = await service.listEvents(req.account, req.query || {});
    return apiResponse.success(res, { events });
  } catch (error) {
    return handle(res, error);
  }
}

export async function update(req, res) {
  try {
    const event = await service.updateEvent(req.account, req.params.eventId, req.body || {});
    return apiResponse.success(res, { event }, 'Breeding event updated');
  } catch (error) {
    return handle(res, error);
  }
}
