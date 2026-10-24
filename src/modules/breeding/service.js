import { BreedingEvent, BREEDING_EVENT_TYPES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import { resolveFarmScope } from '../../shared/farm/resolveScope.js';
import { assertAnimalInFarm } from '../animals/service.js';
import { parseBusinessDate, formatBusinessDate } from '../../shared/time/businessDate.js';

function publicEvent(doc) {
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    animalId: String(doc.animalId),
    relatedAnimalId: doc.relatedAnimalId ? String(doc.relatedAnimalId) : null,
    eventType: doc.eventType,
    eventDate: formatBusinessDate(doc.eventDate),
    outcome: doc.outcome || null,
    notes: doc.notes || null,
    recordedByAccountId: doc.recordedByAccountId ? String(doc.recordedByAccountId) : null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

export async function createEvent(account, input = {}) {
  const { farmerProfile } = await resolveFarmScope(account, input.farmerProfileId, 'breeding.record');
  if (!input.animalId) throw new AppError(400, 'ANIMAL_REQUIRED', 'animalId is required');
  await assertAnimalInFarm(input.animalId, farmerProfile._id);

  // Optional second animal (e.g. sire) must belong to the same farmer scope.
  if (input.relatedAnimalId) {
    await assertAnimalInFarm(input.relatedAnimalId, farmerProfile._id);
  }

  const eventType = typeof input.eventType === 'string' ? input.eventType.trim().toLowerCase() : '';
  if (!BREEDING_EVENT_TYPES.includes(eventType)) {
    throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${BREEDING_EVENT_TYPES.join(', ')}`);
  }

  const eventDate = parseBusinessDate(input.eventDate, { field: 'eventDate', required: true });

  const row = await BreedingEvent.create({
    farmerProfileId: farmerProfile._id,
    animalId: input.animalId,
    relatedAnimalId: input.relatedAnimalId || undefined,
    eventType,
    eventDate,
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
  if (query.from || query.to) {
    filter.eventDate = {};
    if (query.from) filter.eventDate.$gte = parseBusinessDate(query.from, { field: 'from' });
    if (query.to) filter.eventDate.$lte = parseBusinessDate(query.to, { field: 'to' });
  }
  const rows = await BreedingEvent.find(filter).sort({ eventDate: -1 }).limit(500);
  return rows.map(publicEvent);
}

export async function updateEvent(account, eventId, input = {}) {
  const row = await BreedingEvent.findById(eventId);
  if (!row) throw new AppError(404, 'BREEDING_EVENT_NOT_FOUND', 'Breeding event not found');
  await resolveFarmScope(account, row.farmerProfileId, 'breeding.update');

  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(row.farmerProfileId)) {
    throw new AppError(
      403,
      'BREEDING_SCOPE_IMMUTABLE',
      'Cannot change farmerProfileId on an existing breeding event',
    );
  }
  if (input.animalId !== undefined && String(input.animalId) !== String(row.animalId)) {
    throw new AppError(
      403,
      'BREEDING_ANIMAL_IMMUTABLE',
      'Cannot reassign animalId on an existing breeding event',
    );
  }

  if (input.eventType !== undefined) {
    const eventType = String(input.eventType).trim().toLowerCase();
    if (!BREEDING_EVENT_TYPES.includes(eventType)) {
      throw new AppError(400, 'INVALID_EVENT_TYPE', `eventType must be one of: ${BREEDING_EVENT_TYPES.join(', ')}`);
    }
    row.eventType = eventType;
  }
  if (input.eventDate !== undefined) {
    row.eventDate = parseBusinessDate(input.eventDate, { field: 'eventDate', required: true });
  }
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

export { publicEvent, BREEDING_EVENT_TYPES };
