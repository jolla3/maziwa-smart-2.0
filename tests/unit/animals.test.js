import { jest } from '@jest/globals';
import { AppError } from '../../src/shared/errors/AppError.js';

const authorizeFarmAccess = jest.fn();
const findOwnedFarmerProfile = jest.fn();
const AnimalFind = jest.fn();
const AnimalFindById = jest.fn();
const AnimalCreate = jest.fn();

jest.unstable_mockModule('../../src/modules/farm-access/service.js', () => ({
  authorizeFarmAccess,
  findOwnedFarmerProfile,
}));

jest.unstable_mockModule('../../src/modules/animals/model.js', () => ({
  Animal: {
    find: AnimalFind,
    findById: AnimalFindById,
    create: AnimalCreate,
  },
  ANIMAL_SPECIES: ['cow', 'goat', 'sheep', 'pig', 'other'],
  ANIMAL_GENDERS: ['female', 'male', 'unknown'],
  ANIMAL_STATUSES: ['active', 'sold', 'deceased', 'inactive'],
}));

const {
  createAnimal,
  updateAnimal,
  getAnimal,
  listAnimals,
  assertAnimalInFarm,
} = await import('../../src/modules/animals/service.js');

const owner = { _id: 'owner-1' };
const manager = { _id: 'mgr-1' };
const stranger = { _id: 'stranger-1' };
const farmerId = 'farm-1';
const otherFarm = 'farm-2';

function animalDoc(overrides = {}) {
  return {
    _id: 'animal-1',
    farmerProfileId: farmerId,
    name: 'Bella',
    species: 'cow',
    gender: 'female',
    breedLabel: 'Friesian',
    status: 'active',
    birthDate: new Date(Date.UTC(2020, 0, 15)),
    save: jest.fn(async function save() { return this; }),
    ...overrides,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  findOwnedFarmerProfile.mockResolvedValue({ _id: farmerId, accountId: owner._id });
});

describe('animals vertical', () => {
  test('owner can create multi-species animals', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId, accountId: owner._id },
      grant: null,
    });
    AnimalCreate.mockImplementation(async (doc) => ({
      _id: 'a1',
      ...doc,
      createdAt: new Date(),
      updatedAt: new Date(),
    }));

    const goat = await createAnimal(owner, { name: 'Nanny', species: 'goat' });
    expect(goat.species).toBe('goat');
    expect(AnimalCreate).toHaveBeenCalledWith(expect.objectContaining({
      farmerProfileId: farmerId,
      species: 'goat',
    }));
  });

  test('rejects invalid species', async () => {
    await expect(createAnimal(owner, { name: 'X', species: 'dragon' }))
      .rejects.toMatchObject({ code: 'INVALID_SPECIES' });
  });

  test('delegate needs animals.create; wrong permission denied', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'Missing delegated permission'));

    await expect(createAnimal(manager, {
      name: 'Bella',
      species: 'cow',
      farmerProfileId: farmerId,
    })).rejects.toMatchObject({ status: 403 });
  });

  test('delegate with animals.create can register animal', async () => {
    findOwnedFarmerProfile.mockResolvedValue(null);
    authorizeFarmAccess
      .mockRejectedValueOnce(new AppError(403, 'FORBIDDEN', 'not owner'))
      .mockResolvedValueOnce({
        mode: 'delegate',
        farmerProfile: { _id: farmerId },
        grant: { permissions: ['animals.create'] },
      });
    AnimalCreate.mockImplementation(async (doc) => ({ _id: 'a2', ...doc }));

    const a = await createAnimal(manager, {
      name: 'Daisy',
      species: 'cow',
      farmerProfileId: farmerId,
      birthDate: '2019-06-01',
    });
    expect(a.birthDate).toBe('2019-06-01');
  });

  test('getAnimal enforces farm scope on the record owner farm', async () => {
    AnimalFindById.mockResolvedValue(animalDoc());
    authorizeFarmAccess.mockRejectedValue(new AppError(403, 'FORBIDDEN', 'no access'));
    await expect(getAnimal(stranger, 'animal-1')).rejects.toMatchObject({ status: 403 });
  });

  test('update rejects ownership transfer via farmerProfileId', async () => {
    const doc = animalDoc();
    AnimalFindById.mockResolvedValue(doc);
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });

    await expect(updateAnimal(owner, 'animal-1', { farmerProfileId: otherFarm }))
      .rejects.toMatchObject({ code: 'OWNERSHIP_TRANSFER_FORBIDDEN' });
    expect(doc.save).not.toHaveBeenCalled();
  });

  test('assertAnimalInFarm rejects cross-farmer animal', async () => {
    AnimalFindById.mockResolvedValue(animalDoc({ farmerProfileId: otherFarm }));
    await expect(assertAnimalInFarm('animal-1', farmerId))
      .rejects.toMatchObject({ code: 'ANIMAL_SCOPE_MISMATCH' });
  });

  test('list filters by species within authorized farm only', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    const chain = {
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([animalDoc({ species: 'goat' })]),
    };
    AnimalFind.mockReturnValue(chain);

    const rows = await listAnimals(owner, { species: 'goat' });
    expect(AnimalFind).toHaveBeenCalledWith({ farmerProfileId: farmerId, species: 'goat' });
    expect(rows).toHaveLength(1);
  });

  test('rejects ambiguous birthDate without timezone', async () => {
    authorizeFarmAccess.mockResolvedValue({
      mode: 'owner',
      farmerProfile: { _id: farmerId },
      grant: null,
    });
    await expect(createAnimal(owner, {
      name: 'X',
      species: 'cow',
      birthDate: '2020-01-15T10:00:00',
    })).rejects.toMatchObject({ code: 'INVALID_DATE' });
  });
});
