import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const authorizeFarmAccess = jest.fn();
const findOwnedFarmerProfile = jest.fn();
const assertAnimalInFarm = jest.fn();
const YieldFind = jest.fn();
const YieldFindById = jest.fn();
const YieldCreate = jest.fn();
const YieldAggregate = jest.fn();

jest.unstable_mockModule('../../src/modules/farm-access/service.js', () => ({
  authorizeFarmAccess,
  findOwnedFarmerProfile,
}));

jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  assertAnimalInFarm,
  publicAnimal: jest.fn(),
}));

jest.unstable_mockModule('../../src/modules/milk-production/model.js', () => ({
  MilkYieldRecord: {
    find: YieldFind,
    findById: YieldFindById,
    create: YieldCreate,
    aggregate: YieldAggregate,
  },
  TIME_SLOTS: ['morning', 'afternoon', 'evening', 'other'],
}));

const {
  recordYield,
  listYields,
  updateYield,
  summarizeYields,
} = await import('../../src/modules/milk-production/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';
const animalId = 'animal-1';

function yieldDoc(overrides = {}) {
  return {
    _id: 'y1',
    farmerProfileId: farmerId,
    animalId,
    yieldDate: new Date(Date.UTC(2026, 0, 10)),
    litres: 12.5,
    timeSlot: 'morning',
    save: jest.fn(async function save() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findOwnedFarmerProfile.mockResolvedValue({ _id: farmerId, accountId: owner._id });
  assertAnimalInFarm.mockResolvedValue({ _id: animalId, farmerProfileId: farmerId });
});

describe('milk-production vertical', () => {
  test('owner can record yield for animal in farm', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    YieldCreate.mockImplementation(async (doc) => ({ _id: 'y1', ...doc }));

    const row = await recordYield(owner, {
      animalId,
      litres: 10,
      yieldDate: '2026-01-10',
      timeSlot: 'morning',
    });
    expect(row.litres).toBe(10);
    expect(row.yieldDate).toBe('2026-01-10');
    expect(row.isFinancial).toBeUndefined();
    expect(YieldCreate).toHaveBeenCalledWith(expect.objectContaining({
      farmerProfileId: farmerId,
      animalId,
      recordedByAccountId: owner._id,
    }));
  });

  test('rejects negative litres', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    await expect(recordYield(owner, {
      animalId,
      litres: -1,
      yieldDate: '2026-01-10',
    })).rejects.toMatchObject({ code: 'INVALID_LITRES' });
  });

  test('rejects animal not in farmer scope', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    assertAnimalInFarm.mockRejectedValue(
      new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'Animal does not belong to this farm'),
    );
    await expect(recordYield(owner, {
      animalId: 'other-animal',
      litres: 5,
      yieldDate: '2026-01-10',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('delegate needs milk.record; milk.read alone is insufficient', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'Missing delegated permission'));

    await expect(recordYield(manager, {
      farmerProfileId: farmerId,
      animalId,
      litres: 3,
      yieldDate: '2026-01-10',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with milk.record can write', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['milk.record'] },
      });
    YieldCreate.mockImplementation(async (doc) => ({ _id: 'y2', ...doc }));

    const row = await recordYield(manager, {
      farmerProfileId: farmerId,
      animalId,
      litres: 8,
      yieldDate: '2026-02-01',
    });
    expect(row.litres).toBe(8);
  });

  test('revoked grant denies milk.read list', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'grant revoked'));

    await expect(listYields(manager, { farmerProfileId: farmerId }))
      .rejects.toMatchObject({ status: 403 });
  });

  test('update cannot move yield to another animal or farm', async () => {
    const doc = yieldDoc();
    YieldFindById.mockResolvedValue(doc);
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });

    await expect(updateYield(owner, 'y1', { animalId: 'other' }))
      .rejects.toMatchObject({ code: 'YIELD_ANIMAL_IMMUTABLE' });
    await expect(updateYield(owner, 'y1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'YIELD_SCOPE_IMMUTABLE' });
  });

  test('summary is production volume only (never financial)', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    YieldAggregate.mockResolvedValue([{ totalLitres: 42, recordCount: 3 }]);

    const s = await summarizeYields(owner, {});
    expect(s.totalLitres).toBe(42);
    expect(s.recordCount).toBe(3);
    expect(s.isFinancial).toBe(false);
  });

  test('yieldDate requires YYYY-MM-DD or zoned ISO', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    await expect(recordYield(owner, {
      animalId,
      litres: 1,
      yieldDate: '2026-01-10T08:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});
