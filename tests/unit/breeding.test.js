import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const resolveFarmScope = jest.fn();
const assertAnimalInFarm = jest.fn();
const Find = jest.fn();
const FindById = jest.fn();
const Create = jest.fn();

jest.unstable_mockModule('../../src/shared/farm/resolveScope.js', () => ({ resolveFarmScope }));
jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  assertAnimalInFarm,
  publicAnimal: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/breeding/model.js', () => ({
  BreedingEvent: { find: Find, findById: FindById, create: Create },
  BREEDING_EVENT_TYPES: [
    'heat', 'insemination', 'natural_service', 'pregnancy_check',
    'confirmed_pregnant', 'not_pregnant', 'calving', 'abortion', 'other',
  ],
}));

const { createEvent, listEvents, updateEvent } = await import('../../src/modules/breeding/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';
const animalId = 'dam-1';
const sireId = 'sire-1';

function doc(overrides = {}) {
  return {
    _id: 'b1',
    farmerProfileId: farmerId,
    animalId,
    relatedAnimalId: sireId,
    eventType: 'insemination',
    eventDate: new Date(Date.UTC(2026, 2, 1)),
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  assertAnimalInFarm.mockResolvedValue({ _id: animalId, farmerProfileId: farmerId });
});

describe('breeding', () => {
  test('owner can create event with related animal on same farm', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm
      .mockResolvedValueOnce({ _id: animalId, farmerProfileId: farmerId })
      .mockResolvedValueOnce({ _id: sireId, farmerProfileId: farmerId });
    Create.mockImplementation(async (d) => ({ _id: 'b1', ...d }));

    const e = await createEvent(owner, {
      animalId,
      relatedAnimalId: sireId,
      eventType: 'insemination',
      eventDate: '2026-03-01',
    });
    expect(e.eventDate).toBe('2026-03-01');
    expect(e.relatedAnimalId).toBe(sireId);
    expect(assertAnimalInFarm).toHaveBeenCalledTimes(2);
  });

  test('rejects related animal from another farm', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm
      .mockResolvedValueOnce({ _id: animalId, farmerProfileId: farmerId })
      .mockRejectedValueOnce(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'cross farm'));

    await expect(createEvent(owner, {
      animalId, relatedAnimalId: 'foreign-sire', eventType: 'natural_service', eventDate: '2026-03-01',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('delegate needs breeding.record', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing'));
    await expect(createEvent(manager, {
      farmerProfileId: farmerId, animalId, eventType: 'heat', eventDate: '2026-03-01',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with breeding.record can write', async () => {
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate', farmerProfile: { _id: farmerId },
      grant: { permissions: ['breeding.record'] },
    });
    Create.mockImplementation(async (d) => ({ _id: 'b2', ...d }));
    const e = await createEvent(manager, {
      farmerProfileId: farmerId, animalId, eventType: 'heat', eventDate: '2026-03-02',
    });
    expect(e.eventType).toBe('heat');
  });

  test('wrong permission denied for list', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'wrong perm'));
    await expect(listEvents(manager, { farmerProfileId: farmerId })).rejects.toMatchObject({ status: 403 });
  });

  test('update cannot reassign primary animal or farm', async () => {
    const row = doc();
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(updateEvent(owner, 'b1', { animalId: 'other' }))
      .rejects.toMatchObject({ code: 'BREEDING_ANIMAL_IMMUTABLE' });
    await expect(updateEvent(owner, 'b1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'BREEDING_SCOPE_IMMUTABLE' });
  });

  test('update relatedAnimalId still validates farm scope', async () => {
    const row = doc({ relatedAnimalId: null });
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(updateEvent(owner, 'b1', { relatedAnimalId: 'foreign' }))
      .rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('rejects invalid event type and date', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createEvent(owner, {
      animalId, eventType: 'cloning', eventDate: '2026-03-01',
    })).rejects.toMatchObject({ code: 'INVALID_EVENT_TYPE' });
    await expect(createEvent(owner, {
      animalId, eventType: 'heat', eventDate: '2026-03-01T09:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});
