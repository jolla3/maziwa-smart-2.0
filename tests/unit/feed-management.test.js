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
jest.unstable_mockModule('../../src/modules/feed-management/model.js', () => ({
  FeedRecord: { find: Find, findById: FindById, create: Create },
  FEED_RECORD_TYPES: ['purchase_note', 'usage', 'adjustment', 'other'],
}));

const {
  createRecord,
  listRecords,
  getRecord,
  updateRecord,
} = await import('../../src/modules/feed-management/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';
const animalId = 'animal-1';

function doc(overrides = {}) {
  return {
    _id: 'f1',
    farmerProfileId: farmerId,
    animalId,
    recordType: 'usage',
    feedName: 'Dairy meal',
    quantity: 25,
    unit: 'kg',
    recordDate: new Date(Date.UTC(2026, 0, 12)),
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  assertAnimalInFarm.mockResolvedValue({ _id: animalId, farmerProfileId: farmerId });
});

describe('feed-management', () => {
  test('owner can create farm-level feed usage without animal', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    Create.mockImplementation(async (d) => ({ _id: 'f1', ...d }));

    const r = await createRecord(owner, {
      recordType: 'usage',
      feedName: 'Hay',
      quantity: 10,
      recordDate: '2026-01-12',
    });
    expect(r.feedName).toBe('Hay');
    expect(r.recordDate).toBe('2026-01-12');
    expect(r.createsFinanceEntry).toBe(false);
    expect(assertAnimalInFarm).not.toHaveBeenCalled();
  });

  test('owner can create animal-scoped usage when animal is in farm', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    Create.mockImplementation(async (d) => ({ _id: 'f2', ...d }));
    const r = await createRecord(owner, {
      animalId,
      recordType: 'usage',
      feedName: 'Dairy meal',
      quantity: 5,
      unit: 'kg',
      recordDate: '2026-01-13',
    });
    expect(r.animalId).toBe(animalId);
    expect(assertAnimalInFarm).toHaveBeenCalledWith(animalId, farmerId);
  });

  test('rejects cross-farmer animal reference', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(createRecord(owner, {
      animalId: 'foreign',
      recordType: 'usage',
      feedName: 'X',
      quantity: 1,
      recordDate: '2026-01-12',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('delegate needs feed.record', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing'));
    await expect(createRecord(manager, {
      farmerProfileId: farmerId,
      recordType: 'usage',
      feedName: 'X',
      quantity: 1,
      recordDate: '2026-01-12',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with feed.read can list and get', async () => {
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate',
      farmerProfile: { _id: farmerId },
      grant: { permissions: ['feed.read'] },
    });
    const chain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([doc()]),
    };
    Find.mockReturnValue(chain);
    FindById.mockResolvedValue(doc());

    const rows = await listRecords(manager, { farmerProfileId: farmerId });
    expect(rows).toHaveLength(1);
    const one = await getRecord(manager, 'f1');
    expect(one.id).toBe('f1');
  });

  test('revoked grant denies read', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'revoked'));
    await expect(listRecords(manager, { farmerProfileId: farmerId }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('update cannot change farmer scope', async () => {
    const row = doc();
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(updateRecord(owner, 'f1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'FEED_SCOPE_IMMUTABLE' });
  });

  test('update animalId validates same farm', async () => {
    const row = doc({ animalId: null });
    FindById.mockResolvedValue(row);
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(updateRecord(owner, 'f1', { animalId: 'foreign' }))
      .rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('rejects invalid quantity and ambiguous date', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createRecord(owner, {
      recordType: 'usage', feedName: 'X', quantity: -1, recordDate: '2026-01-12',
    })).rejects.toMatchObject({ code: 'INVALID_QUANTITY' });
    await expect(createRecord(owner, {
      recordType: 'usage', feedName: 'X', quantity: 1, recordDate: '2026-01-12T08:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });

  test('rejects invalid recordType and missing feedName', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(createRecord(owner, {
      recordType: 'inventory_count', feedName: 'X', quantity: 1, recordDate: '2026-01-12',
    })).rejects.toMatchObject({ code: 'INVALID_RECORD_TYPE' });
    await expect(createRecord(owner, {
      recordType: 'usage', quantity: 1, recordDate: '2026-01-12',
    })).rejects.toMatchObject({ code: 'FEED_NAME_REQUIRED' });
  });
});
