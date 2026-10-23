import { BreedingEvent, BREEDING_EVENT_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';

function publicEvent(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: String(doc.animalId),
    relatedAnimalId: doc.relatedAnimalId ? String(doc.relatedAnimalId) : null,
    eventType: doc.eventType,
    eventDate: doc.eventDate,
    outcome: doc.outcome || null,
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

export async function createEvent(account, input = {}) {
  const { farmerProfile } = await resolveFarmScope(account, input.farmerProfileId, 'breeding.record');
  if (!input.animalId) throw new AppError(400, 'ANIMAL_REQUIRED', 'animalId is required');
  await assertAnimalInFarm(input.animalId, farmerProfile._id);
  if (input.relatedAnimalId) {
    await assertAnimalInFarm(input.relatedAnimalId, farmerProfile._id);
  }

  const eventType = typeof input.eventType === 'string' ? input.eventType.trim().toLowerCase() : '';
  if (!BREEDING_EVENT_TYPES.includes(eventType)) {
    throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${BREEDING_EVENT_TYPES.join(', ')}`);
  }

  const row = await BreedingEvent.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId,
    relatedAnimalId: input.relatedAnimalId || undefined,
    eventType,
    eventDate: parseDate(input.eventDate),
    outcome: input.outcome ? String(input.outcome).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
    recordedByAccountId: account._id,
  });
  return publicEvent(row);
}

export async function listEvents(account, query = {}) {
  const { farmerProfile } = await resolveFarmScope(account, query.farmerProfileId, 'breeding.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.animalId) filter.animalId = query.animalId;
  if (query.eventType && BREEDING_EVENT_TYPES.includes(query.eventType)) filter.eventType = query.eventType;
  const rows = await BreedingEvent.find(filter).sort({ eventDate: -1 }).limit(500);
  return rows.map(publicEvent);
}

export async function updateEvent(account, eventId, input = {}) {
  const row = await BreedingEvent.findById(eventId);
  if (!row) throw new AppError(404, 'BREEDING_EVENT_NOT_FOUND', 'Breeding event not found');
  await resolveFarmScope(account, row.farmerProfileId, 'breeding.update');

  if (input.eventType !== undefined) {
    const eventType = String(input.eventType).trim().toLowerCase();
    if (!BREEDING_EVENT_TYPES.includes(eventType)) {
      throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${BREEDING_EVENT_TYPES.join(', ')}`);
    }
    row.eventType = eventType;
  }
  if (input.eventDate !== undefined) row.eventDate = parseDate(input.eventDate);
  if (input.outcome !== undefined) row.outcome = String(input.outcome).trim();
  if (input.notes !== undefined) row.notes = String(input.notes).trim();
  if (input.relatedAnimalId !== undefined) {
    if (input.relatedAnimalId) {
      await assertAnimalInFarm(input.relatedAnimalId, row.farmerProfileId);
      row.relatedAnimalId = input.relatedAnimalId;
    } else {
      row.relatedAnimalId = undefined;
    }
  }
  await row.save();
  return publicEvent(row);
}
