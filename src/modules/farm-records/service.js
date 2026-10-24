import {
  CustomRecordDefinition,
  CustomRecordEntry,
  CUSTOM_FIELD_TYPES,
} from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { findOwnedFarmerProfile } from '../farm-access/service.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { parseBusinessDate, formatBusinessDate } from '../../shared/time/businessDate.js';

function publicDefinition(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    name: doc.name,
    description: doc.description || null,
    fields: (doc.fields || []).map((f) => ({
      key: f.key,
      label: f.label || f.key,
      type: f.type,
      required: Boolean(f.required),
    })),
    isActive: doc.isActive !== false,
    createdByAccountId: doc.createdByAccountId ? String(doc.createdByAccountId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function publicEntry(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    definitionId: String(doc.definitionId),
    animalId: doc.animalId ? String(doc.animalId) : null,
    values: doc.values || {},
    recordDate: formatBusinessDate(doc.recordDate),
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Definition management is owner-only per SERVICE_CONTRACTS §J
 * ("definition admin not delegated unless later approved").
 */
async function requireOwnerScope(account, farmerProfileId) {
  let scopeId = farmerProfileId;
  if (!scopeId) {
    const owned = await findOwnedFarmerProfile(account._id);
    if (!owned) {
      throw new AppError(
        400,
        'FARMER_SCOPE_REQUIRED',
        'farmerProfileId is required when the account does not own a farmer profile',
      );
    }
    scopeId = owned._id;
  }
  const result = await resolveFarmScope(account, scopeId, null);
  if (result.mode !== 'owner') {
    throw new AppError(
      403,
      'DEFINITION_OWNER_ONLY',
      'Custom record definitions can only be managed by the farm owner',
    );
  }
  return result;
}

function normalizeFields(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AppError(400, 'FIELDS_REQUIRED', 'At least one field definition is required');
  }
  const seen = new Set();
  const normalized = [];
  for (const raw of fields) {
    const key = typeof raw?.key === 'string' ? raw.key.trim() : '';
    if (!key) throw new AppError(400, 'FIELD_KEY_REQUIRED', 'Each field requires a key');
    if (seen.has(key)) throw new AppError(400, 'DUPLICATE_FIELD_KEY', `Duplicate field key: ${key}`);
    seen.add(key);
    const type = typeof raw.type === 'string' ? raw.type.trim().toLowerCase() : '';
    if (!CUSTOM_FIELD_TYPES.includes(type)) {
      throw new AppError(
        400,
        'INVALID_FIELD_TYPE',
        `field type must be one of: ${CUSTOM_FIELD_TYPES.join(', ')}`,
      );
    }
    normalized.push({
      key,
      label: raw.label ? String(raw.label).trim() : key,
      type,
      required: Boolean(raw.required),
    });
  }
  return normalized;
}

function validateValuesAgainstDefinition(definition, values) {
  if (values === null || typeof values !== 'object' || Array.isArray(values)) {
    throw new AppError(400, 'INVALID_VALUES', 'values must be an object map');
  }
  const fieldMap = new Map((definition.fields || []).map((f) => [f.key, f]));
  const cleaned = {};

  for (const key of Object.keys(values)) {
    if (!fieldMap.has(key)) {
      throw new AppError(400, 'UNKNOWN_FIELD', `Unknown field for this definition: ${key}`);
    }
  }

  for (const field of definition.fields || []) {
    const has = Object.prototype.hasOwnProperty.call(values, field.key);
    const raw = has ? values[field.key] : undefined;
    if (!has || raw === undefined || raw === null || raw === '') {
      if (field.required) {
        throw new AppError(400, 'REQUIRED_FIELD', `Field is required: ${field.key}`);
      }
      continue;
    }
    switch (field.type) {
      case 'string':
        cleaned[field.key] = String(raw);
        break;
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(raw);
        if (!Number.isFinite(n)) {
          throw new AppError(400, 'INVALID_FIELD_VALUE', `Field ${field.key} must be a number`);
        }
        cleaned[field.key] = n;
        break;
      }
      case 'boolean':
        if (typeof raw === 'boolean') cleaned[field.key] = raw;
        else if (raw === 'true' || raw === 'false') cleaned[field.key] = raw === 'true';
        else throw new AppError(400, 'INVALID_FIELD_VALUE', `Field ${field.key} must be a boolean`);
        break;
      case 'date':
        cleaned[field.key] = formatBusinessDate(
          parseBusinessDate(raw, { field: field.key, required: true }),
        );
        break;
      default:
        throw new AppError(400, 'INVALID_FIELD_TYPE', `Unsupported field type: ${field.type}`);
    }
  }
  return cleaned;
}

// --- Definitions (owner-only) ---

export async function createDefinition(account, input = {}) {
  const { farmerProfile } = await requireOwnerScope(account, input.farmerProfileId);
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new AppError(400, 'NAME_REQUIRED', 'Definition name is required');
  const fields = normalizeFields(input.fields);

  const doc = await CustomRecordDefinition.create({
    farmerProfileId: farmerProfile._id,
    name,
    description: input.description ? String(input.description).trim() : undefined,
    fields,
    isActive: input.isActive !== false,
    createdByAccountId: account._id,
  });
  return publicDefinition(doc);
}

export async function listDefinitions(account, query = {}) {
  // Owners and delegates with custom_records.read may list definitions for entry context.
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'custom_records.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.activeOnly === 'true' || query.activeOnly === true) filter.isActive = true;
  const rows = await CustomRecordDefinition.find(filter).sort({ name: 1 }).limit(200);
  return rows.map(publicDefinition);
}

export async function getDefinition(account, definitionId) {
  const doc = await CustomRecordDefinition.findById(definitionId);
  if (!doc) throw new AppError(404, 'DEFINITION_NOT_FOUND', 'Custom record definition not found');
  await resolveFarmScope(account, doc.farmerProfileId, 'custom_records.read');
  return publicDefinition(doc);
}

export async function updateDefinition(account, definitionId, input = {}) {
  const doc = await CustomRecordDefinition.findById(definitionId);
  if (!doc) throw new AppError(404, 'DEFINITION_NOT_FOUND', 'Custom record definition not found');
  await requireOwnerScope(account, doc.farmerProfileId);

  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(doc.farmerProfileId)) {
    throw new AppError(403, 'DEFINITION_SCOPE_IMMUTABLE', 'Cannot change farmerProfileId on a definition');
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new AppError(400, 'NAME_REQUIRED', 'Definition name cannot be empty');
    doc.name = name;
  }
  if (input.description !== undefined) doc.description = String(input.description).trim();
  if (input.fields !== undefined) doc.fields = normalizeFields(input.fields);
  if (input.isActive !== undefined) doc.isActive = Boolean(input.isActive);
  await doc.save();
  return publicDefinition(doc);
}

// --- Entries ---

async function loadDefinitionInScope(definitionId, farmerProfileId) {
  const def = await CustomRecordDefinition.findById(definitionId);
  if (!def || !def.isActive) {
    throw new AppError(404, 'DEFINITION_NOT_FOUND', 'Custom record definition not found or inactive');
  }
  if (String(def.farmerProfileId) !== String(farmerProfileId)) {
    throw new AppError(403, 'DEFINITION_SCOPE_MISMATCH', 'Definition does not belong to this farm');
  }
  return def;
}

export async function createEntry(account, input = {}) {
  const { farmerProfile } = await resolveFarmScope(account, input.farmerProfileId, 'custom_records.create');
  if (!input.definitionId) throw new AppError(400, 'DEFINITION_REQUIRED', 'definitionId is required');

  const definition = await loadDefinitionInScope(input.definitionId, farmerProfile._id);
  if (input.animalId) {
    await assertAnimalInFarm(input.animalId, farmerProfile._id);
  }

  const values = validateValuesAgainstDefinition(definition, input.values || {});
  const recordDate = parseBusinessDate(input.recordDate, { field: 'recordDate', required: true });

  const row = await CustomRecordEntry.create({
    farmerProfileId: farmerProfile._id,
    definitionId: definition._id,
    animalId: input.animalId || undefined,
    values,
    recordDate,
    notes: input.notes ? String(input.notes).trim() : undefined,
    recordedByAccountId: account._id,
  });
  return publicEntry(row);
}

export async function listEntries(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'custom_records.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.definitionId) filter.definitionId = query.definitionId;
  if (query.animalId) filter.animalId = query.animalId;
  if (query.from || query.to) {
    filter.recordDate = {};
    if (query.from) filter.recordDate.$gte = parseBusinessDate(query.from, { field: 'from' });
    if (query.to) filter.recordDate.$lte = parseBusinessDate(query.to, { field: 'to' });
  }
  const rows = await CustomRecordEntry.find(filter).sort({ recordDate: -1 }).limit(500);
  return rows.map(publicEntry);
}

export async function getEntry(account, entryId) {
  const row = await CustomRecordEntry.findById(entryId);
  if (!row) throw new AppError(404, 'ENTRY_NOT_FOUND', 'Custom record entry not found');
  await resolveFarmScope(account, row.farmerProfileId, 'custom_records.read');
  return publicEntry(row);
}

export async function updateEntry(account, entryId, input = {}) {
  const row = await CustomRecordEntry.findById(entryId);
  if (!row) throw new AppError(404, 'ENTRY_NOT_FOUND', 'Custom record entry not found');
  await resolveFarmScope(account, row.farmerProfileId, 'custom_records.update');

  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(row.farmerProfileId)) {
    throw new AppError(403, 'ENTRY_SCOPE_IMMUTABLE', 'Cannot change farmerProfileId on an entry');
  }
  if (input.definitionId !== undefined
      && String(input.definitionId) !== String(row.definitionId)) {
    throw new AppError(403, 'ENTRY_DEFINITION_IMMUTABLE', 'Cannot change definitionId on an entry');
  }

  const definition = await loadDefinitionInScope(row.definitionId, row.farmerProfileId);

  if (input.animalId !== undefined) {
    if (input.animalId) {
      await assertAnimalInFarm(input.animalId, row.farmerProfileId);
      row.animalId = input.animalId;
    } else {
      row.animalId = undefined;
    }
  }
  if (input.values !== undefined) {
    row.values = validateValuesAgainstDefinition(definition, input.values);
  }
  if (input.recordDate !== undefined) {
    row.recordDate = parseBusinessDate(input.recordDate, { field: 'recordDate', required: true });
  }
  if (input.notes !== undefined) row.notes = String(input.notes).trim();

  await row.save();
  return publicEntry(row);
}

export { publicDefinition, publicEntry, CUSTOM_FIELD_TYPES };
