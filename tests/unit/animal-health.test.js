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
jest.unstable_mockModule('../../src/modules/animal-health/model.js', () => ({
  AnimalHealthRecord: { find: Find, findById: FindById, create: Create },
  HEALTH_EVENT_TYPES: ['checkup', 'vaccination', 'treatment', 'diagnosis', 'injury', 'other'],
}));

const { createRecord, listRecords, updateRecord } = await import('../../src/modules/animal-health/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';
const animalId = 'animal-1';

function doc(overrides = {}) {
  return {
    _id: 'h1',
    farmerProfileId: farmerId,
    animalId,
    eventType: 'vaccination',
    eventDate: new Date(Date.UTC(2026, 0, 5)),
    title: 'FMD vaccine',
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  assertAnimalInFarm.mockResolvedValue({ _id: animalId, farmerProfileId: farmerId });
});

describe('animal-health', () => {
  test('owner can create health record', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    Create.mockImplementation(async (d) => ({ _id: 'h1', ...d }));
    const r = await createRecord(owner, {
      animalId, eventType: 'vaccination', title: 'FMD', eventDate: '2026-01-05',
    });
    expect(r.eventDate).toBe('2026-01-05');
    expect(Create).toHaveBeenCalledWith(expect.objectContaining({
      farmerProfileId: farmerId,
      recordedByAccountId: owner._id,
    }));
  });

  test('requires title and valid eventType', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createRecord(owner, {
      animalId, eventType: 'vaccination', eventDate: '2026-01-05',
    })).rejects.toMatchObject({ code: 'TITLE_REQUIRED' });
    await expect(createRecord(owner, {
      animalId, eventType: 'surgery', title: 'X', eventDate: '2026-01-05',
    })).rejects.toMatchObject({ code: 'INVALID_EVENT_TYPE' });
  });

  test('cross-farmer animal denied', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(createRecord(owner, {
      animalId: 'other', eventType: 'checkup', title: 'X', eventDate: '2026-01-05',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('delegate needs health.record', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing'));
    await expect(createRecord(manager, {
      farmerProfileId: farmerId, animalId, eventType: 'checkup', title: 'X', eventDate: '2026-01-05',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with health.read can list', async () => {
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate', farmerProfile: { _id: farmerId },
      grant: { permissions: ['health.read'] },
    });
    const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([doc()]) };
    Find.mockReturnValue(chain);
    const rows = await listRecords(manager, { farmerProfileId: farmerId });
    expect(rows).toHaveLength(1);
  });

  test('revoked grant denies list', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'revoked'));
    await expect(listRecords(manager, { farmerProfileId: farmerId })).rejects.toMatchObject({ status: 403 });
  });

  test('update cannot reassign animal or farm', async () => {
    const row = doc();
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(updateRecord(owner, 'h1', { animalId: 'other' }))
      .rejects.toMatchObject({ code: 'HEALTH_ANIMAL_IMMUTABLE' });
    await expect(updateRecord(owner, 'h1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'HEALTH_SCOPE_IMMUTABLE' });
  });

  test('rejects ambiguous eventDate', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createRecord(owner, {
      animalId, eventType: 'checkup', title: 'X', eventDate: '2026-01-05T10:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});
