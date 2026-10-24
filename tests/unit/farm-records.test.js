import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const resolveFarmScope = jest.fn();
const findOwnedFarmerProfile = jest.fn();
const assertAnimalInFarm = jest.fn();
const DefFind = jest.fn();
const DefFindById = jest.fn();
const DefCreate = jest.fn();
const EntryFind = jest.fn();
const EntryFindById = jest.fn();
const EntryCreate = jest.fn();

jest.unstable_mockModule('../../src/shared/farm/resolveScope.js', () => ({ resolveFarmScope }));
jest.unstable_mockModule('../../src/modules/farm-access/service.js', () => ({
  findOwnedFarmerProfile,
  authorizeFarmAccess: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/animals/service.js', () => ({
  assertAnimalInFarm,
  publicAnimal: jest.fn(),
}));
jest.unstable_mockModule('../../src/modules/farm-records/model.js', () => ({
  CustomRecordDefinition: {
    find: DefFind,
    findById: DefFindById,
    create: DefCreate,
  },
  CustomRecordEntry: {
    find: EntryFind,
    findById: EntryFindById,
    create: EntryCreate,
  },
  CUSTOM_FIELD_TYPES: ['string', 'number', 'boolean', 'date'],
}));

const {
  createDefinition,
  updateDefinition,
  createEntry,
  listEntries,
  getEntry,
  updateEntry,
} = await import('../../src/modules/farm-records/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const farmerId = 'farm-1';
const definitionId = 'def-1';
const animalId = 'animal-1';

const fields = [
  { key: 'score', type: 'number', required: true, label: 'Score' },
  { key: 'note', type: 'string', required: false, label: 'Note' },
];

function defDoc(overrides = {}) {
  return {
    _id: definitionId,
    farmerProfileId: farmerId,
    name: 'Condition score',
    fields,
    isActive: true,
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

function entryDoc(overrides = {}) {
  return {
    _id: 'entry-1',
    farmerProfileId: farmerId,
    definitionId,
    animalId,
    values: { score: 3 },
    recordDate: new Date(Date.UTC(2026, 0, 20)),
    save: jest.fn(async function s() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findOwnedFarmerProfile.mockResolvedValue({ _id: farmerId, accountId: owner._id });
  assertAnimalInFarm.mockResolvedValue({ _id: animalId, farmerProfileId: farmerId });
});

describe('farm-records definitions (owner-only)', () => {
  test('owner can create definition', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    DefCreate.mockImplementation(async (d) => ({ _id: definitionId, ...d }));
    const def = await createDefinition(owner, { name: 'Condition score', fields });
    expect(def.name).toBe('Condition score');
    expect(def.fields).toHaveLength(2);
  });

  test('delegate cannot create definition', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate',
      farmerProfile: { _id: farmerId },
      grant: { permissions: ['custom_records.create'] },
    });
    await expect(createDefinition(manager, {
      farmerProfileId: farmerId,
      name: 'X',
      fields,
    })).rejects.toMatchObject({ code: 'DEFINITION_OWNER_ONLY' });
  });

  test('delegate cannot update definition even with custom_records.update', async () => {
    DefFindById.mockResolvedValue(defDoc());
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate',
      farmerProfile: { _id: farmerId },
      grant: { permissions: ['custom_records.update'] },
    });
    await expect(updateDefinition(manager, definitionId, { name: 'Y' }))
      .rejects.toMatchObject({ code: 'DEFINITION_OWNER_ONLY' });
  });
});

describe('farm-records entries', () => {
  test('owner can create entry with valid values', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    DefFindById.mockResolvedValue(defDoc());
    EntryCreate.mockImplementation(async (d) => ({ _id: 'entry-1', ...d }));
    const e = await createEntry(owner, {
      definitionId,
      values: { score: 4, note: 'good' },
      recordDate: '2026-01-20',
      animalId,
    });
    expect(e.values.score).toBe(4);
    expect(e.recordDate).toBe('2026-01-20');
    expect(assertAnimalInFarm).toHaveBeenCalledWith(animalId, farmerId);
  });

  test('rejects unknown or missing required fields', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    DefFindById.mockResolvedValue(defDoc());
    await expect(createEntry(owner, {
      definitionId, values: { score: 1, extra: 'x' }, recordDate: '2026-01-20',
    })).rejects.toMatchObject({ code: 'UNKNOWN_FIELD' });
    await expect(createEntry(owner, {
      definitionId, values: { note: 'only' }, recordDate: '2026-01-20',
    })).rejects.toMatchObject({ code: 'REQUIRED_FIELD' });
  });

  test('cross-farmer animal denied', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    DefFindById.mockResolvedValue(defDoc());
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(createEntry(owner, {
      definitionId, values: { score: 2 }, recordDate: '2026-01-20', animalId: 'foreign',
    })).rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('definition from another farm denied', async () => {
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    DefFindById.mockResolvedValue(defDoc({ farmerProfileId: 'farm-other' }));
    await expect(createEntry(owner, {
      definitionId, values: { score: 2 }, recordDate: '2026-01-20',
    })).rejects.toMatchObject({ code: 'DEFINITION_SCOPE_MISMATCH' });
  });

  test('delegate needs custom_records.create', async () => {
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'missing'));
    await expect(createEntry(manager, {
      farmerProfileId: farmerId, definitionId, values: { score: 1 }, recordDate: '2026-01-20',
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with custom_records.read can list', async () => {
    resolveFarmScope.mockResolvedValue({
      mode: 'delegate',
      farmerProfile: { _id: farmerId },
      grant: { permissions: ['custom_records.read'] },
    });
    const chain = { sort: jest.fn().mockReturnThis(), limit: jest.fn().mockResolvedValue([entryDoc()]) };
    EntryFind.mockReturnValue(chain);
    const rows = await listEntries(manager, { farmerProfileId: farmerId });
    expect(rows).toHaveLength(1);
  });

  test('revoked grant denies get', async () => {
    EntryFindById.mockResolvedValue(entryDoc());
    resolveFarmScope.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'revoked'));
    await expect(getEntry(manager, 'entry-1')).rejects.toMatchObject({ status: 403 });
  });

  test('update cannot change farmer or definition', async () => {
    EntryFindById.mockResolvedValue(entryDoc());
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    await expect(updateEntry(owner, 'entry-1', { farmerProfileId: 'farm-x' }))
      .rejects.toMatchObject({ code: 'ENTRY_SCOPE_IMMUTABLE' });
    await expect(updateEntry(owner, 'entry-1', { definitionId: 'def-other' }))
      .rejects.toMatchObject({ code: 'ENTRY_DEFINITION_IMMUTABLE' });
  });

  test('update animal still validates farm scope', async () => {
    EntryFindById.mockResolvedValue(entryDoc({ animalId: null }));
    DefFindById.mockResolvedValue(defDoc());
    resolveFarmScope.mockResolvedValue({ mode: 'owner', farmerProfile: { _id: farmerId } });
    assertAnimalInFarm.mockRejectedValue(new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'no'));
    await expect(updateEntry(owner, 'entry-1', { animalId: 'foreign' }))
      .rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });
});
