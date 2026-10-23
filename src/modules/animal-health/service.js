import { AnimalHealthRecord, HEALTH_EVENT_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';

function publicRecord(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: String(doc.animalId),
    eventType: doc.eventType,
    eventDate: doc.eventDate,
    title: doc.title,
    diagnosis: doc.diagnosis || null,
    treatment: doc.treatment || null,
    medication: doc.medication || null,
    veterinarian: doc.veterinarian || null,
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

function parseDate(value) {
  if (!value) throw new AppError(400, 'EVENT_DATE_REQUIRED', 'eventDate is required');
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw new AppError(400, 'INVALID_EVENT_DATE', 'eventDate is invalid');
  return d;
}

export async function createRecord(account, input = {}) {
  const { farmerProfile } = await resolveFarmScope(account, input.farmerProfileId, 'health.record');
  if (!input.animalId) throw new AppError(400, 'ANIMAL_REQUIRED', 'animalId is required');
  await assertAnimalInFarm(input.animalId, farmerProfile._id);

  const eventType = typeof input.eventType === 'string' ? input.eventType.trim().toLowerCase() : '';
  if (!HEALTH_EVENT_TYPES.includes(eventType)) {
    throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${HEALTH_EVENT_TYPES.join(', ')}`);
  }
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (!title) throw new AppError(400, 'TITLE_REQUIRED', 'title is required');

  const row = await AnimalHealthRecord.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId,
    eventType,
    eventDate: parseDate(input.eventDate),
    title,
    diagnosis: input.diagnosis ? String(input.diagnosis).trim() : undefined,
    treatment: input.treatment ? String(input.treatment).trim() : undefined,
    medication: input.medication ? String(input.medication).trim() : undefined,
    veterinarian: input.veterinarian ? String(input.veterinarian).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
    recordedByAccountId: account._id,
  });
  return publicRecord(row);
}

export async function listRecords(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'health.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.animalId) filter.animalId = query.animalId;
  if (query.eventType && HEALTH_EVENT_TYPES.includes(query.eventType)) filter.eventType = query.eventType;
  const rows = await AnimalHealthRecord.find(filter).sort({ eventDate: -1 }).limit(500);
  return rows.map(publicRecord);
}

export async function updateRecord(account, recordId, input = {}) {
  const row = await AnimalHealthRecord.findById(recordId);
  if (!row) throw new AppError(404, 'HEALTH_RECORD_NOT_FOUND', 'Health record not found');
  await resolveFarmScope(account, row.farmerProfileId, 'health.update');

  if (input.title !== undefined) {
    const title = String(input.title).trim();
    if (!title) throw new AppError(400, 'TITLE_REQUIRED', 'title cannot be empty');
    row.title = title;
  }
  if (input.eventType !== undefined) {
    const eventType = String(input.eventType).trim().toLowerCase();
    if (!HEALTH_EVENT_TYPES.includes(eventType)) {
      throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${HEALTH_EVENT_TYPES.join(', ')}`);
    }
    row.eventType = eventType;
  }
  if (input.eventDate !== undefined) row.eventDate = parseDate(input.eventDate);
  for (const field of ['diagnosis', 'treatment', 'medication', 'veterinarian', 'notes']) {
    if (input[field] !== undefined) row[field] = String(input[field]).trim();
  }
  await row.save();
  return publicRecord(row);
}
