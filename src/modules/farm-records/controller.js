import { apiResponse } from '../../shared/http/response.js';
import { AppError } from '../../shared/errors/AppError.js';
import * as service from './service.js';

function handle(res, error) {
  if (error instanceof AppError) {
    return apiResponse.error(res, error.code, error.message, error.status, error.details);
  }
  throw error;
}

export async function createDefinition(req, res) {
  try {
    const definition = await service.createDefinition(req.account, req.body || {});
    return apiResponse.success(res, { definition }, 'Custom record definition created', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function listDefinitions(req, res) {
  try {
    const definitions = await service.listDefinitions(req.account, req.query || {});
    return apiResponse.success(res, { definitions });
  } catch (error) {
    return handle(res, error);
  }
}

export async function getDefinition(req, res) {
  try {
    const definition = await service.getDefinition(req.account, req.params.definitionId);
    return apiResponse.success(res, { definition });
  } catch (error) {
    return handle(res, error);
  }
}

export async function updateDefinition(req, res) {
  try {
    const definition = await service.updateDefinition(req.account, req.params.definitionId, req.body || {});
    return apiResponse.success(res, { definition }, 'Custom record definition updated');
  } catch (error) {
    return handle(res, error);
  }
}

export async function createEntry(req, res) {
  try {
    const entry = await service.createEntry(req.account, req.body || {});
    return apiResponse.success(res, { entry }, 'Custom record entry created', 201);
  } catch (error) {
    return handle(res, error);
  }
}

export async function listEntries(req, res) {
  try {
    const entries = await service.listEntries(req.account, req.query || {});
    return apiResponse.success(res, { entries });
  } catch (error) {
    return handle(res, error);
  }
}

export async function getEntry(req, res) {
  try {
    const entry = await service.getEntry(req.account, req.params.entryId);
    return apiResponse.success(res, { entry });
  } catch (error) {
    return handle(res, error);
  }
}

export async function updateEntry(req, res) {
  try {
    const entry = await service.updateEntry(req.account, req.params.entryId, req.body || {});
    return apiResponse.success(res, { entry }, 'Custom record entry updated');
  } catch (error) {
    return handle(res, error);
  }
}
