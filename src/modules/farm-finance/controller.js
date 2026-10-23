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
    const entry = await service.createEntry(req.account, req.body || {});
    return apiResponse.success(res, { entry }, 'Financial entry recorded', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function list(req, res) {
  try {
    const entries = await service.listEntries(req.account, req.query || {});
    return apiResponse.success(res, { entries });
  } catch (error) {
    return handle(res, error);
  }
}

export async function update(req, res) {
  try {
    const entry = await service.updateEntry(req.account, req.params.entryId, req.body || {});
    return apiResponse.success(res, { entry }, 'Financial entry updated');
  } catch (error) {
    return handle(res, error);
  }
}

export async function voidEntry(req, res) {
  try {
    const entry = await service.voidEntry(req.account, req.params.entryId);
    return apiResponse.success(res, { entry }, 'Financial entry voided');
  } catch (error) {
    return handle(res, error);
  }
}

export async function summary(req, res) {
  try {
    const summary = await service.summarize(req.account, req.query || {});
    return apiResponse.success(res, { summary });
  } catch (error) {
    return handle(res, error);
  }
}
