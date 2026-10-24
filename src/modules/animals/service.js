import { Animal, ANIMAL_SPECIES, ANIMAL_GENDERS, ANIMAL_STATUSES } from './model.js';
import { AppError } from '../../shared/errors/AppError.js';
import {
  authorizeFarmAccess,
  findOwnedFarmerProfile,
} from '../farm-access/service.js';
import { parseBusinessDate, formatBusinessDate } from '../../shared/time/businessDate.js';

function publicAnimal(doc) {
  if (!doc) return null;
  return {
    id: String(doc._id),
    farmerProfileId: String(doc.farmerProfileId),
    name: doc.name,
    species: doc.species,
    gender: doc.gender,
    breedLabel: doc.breedLabel || '',
    animalBreedId: doc.animalBreedId ? String(doc.animalBreedId) : null,
    birthDate: formatBusinessDate(doc.birthDate),
    status: doc.status,
    tagCode: doc.tagCode || null,
    notes: doc.notes || null,
    photoUrl: doc.photoUrl || null,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
  };
}

/**
 * Owners are authorized without a delegated permission string.
 * Delegates require the exact catalog permission for the operation.
 */
async function resolveScope(account, farmerProfileId, permission) {
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
  try {
    return await authorizeFarmAccess(account, scopeId, null);
  } catch (error) {
    if (error instanceof AppError && error.status === 403 && permission) {
      return authorizeFarmAccess(account, scopeId, permission);
    }
    throw error;
  }
}

export async function listAnimals(account, query = {}) {
  const { farmerProfile } = await resolveScope(account, query.farmerProfileId, 'animals.read');
  const filter = { farmerProfileId: farmerProfile._id };
  if (query.status && ANIMAL_STATUSES.includes(query.status)) filter.status = query.status;
  if (query.species && ANIMAL_SPECIES.includes(query.species)) filter.species = query.species;
  const rows = await Animal.find(filter).sort({ createdAt: -1 }).limit(500);
  return rows.map(publicAnimal);
}

export async function getAnimal(account, animalId) {
  const animal = await Animal.findById(animalId);
  if (!animal) throw new AppError(404, 'ANIMAL_NOT_FOUND', 'Animal not found');
  await resolveScope(account, animal.farmerProfileId, 'animals.read');
  return publicAnimal(animal);
}

export async function createAnimal(account, input = {}) {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new AppError(400, 'NAME_REQUIRED', 'Animal name is required');

  const species = typeof input.species === 'string' ? input.species.trim().toLowerCase() : '';
  if (!ANIMAL_SPECIES.includes(species)) {
    throw new AppError(400, 'INVALID_SPECIES', `species must be one of: ${ANIMAL_SPECIES.join(', ')}`);
  }

  const { farmerProfile } = await resolveScope(account, input.farmerProfileId, 'animals.create');
  const gender = ANIMAL_GENDERS.includes(input.gender) ? input.gender : 'unknown';
  const status = ANIMAL_STATUSES.includes(input.status) ? input.status : 'active';

  const birthDate = parseBusinessDate(input.birthDate, { field: 'birthDate', required: false });

  const animal = await Animal.create({
    farmerProfileId: farmerProfile._id,
    name,
    species,
    gender,
    breedLabel: input.breedLabel ? String(input.breedLabel).trim() : '',
    animalBreedId: input.animalBreedId || undefined,
    birthDate,
    status,
    tagCode: input.tagCode ? String(input.tagCode).trim() : undefined,
    notes: input.notes ? String(input.notes).trim() : undefined,
    photoUrl: input.photoUrl ? String(input.photoUrl).trim() : undefined,
  });

  return publicAnimal(animal);
}

export async function updateAnimal(account, animalId, input = {}) {
  const animal = await Animal.findById(animalId);
  if (!animal) throw new AppError(404, 'ANIMAL_NOT_FOUND', 'Animal not found');
  await resolveScope(account, animal.farmerProfileId, 'animals.update');

  // Ownership transfer is not authorized by the permission catalog.
  if (input.farmerProfileId !== undefined
      && String(input.farmerProfileId) !== String(animal.farmerProfileId)) {
    throw new AppError(
      403,
      'OWNERSHIP_TRANSFER_FORBIDDEN',
      'Changing farmerProfileId (ownership transfer) is not permitted',
    );
  }

  if (input.name !== undefined) {
    const name = String(input.name).trim();
    if (!name) throw new AppError(400, 'NAME_REQUIRED', 'Animal name cannot be empty');
    animal.name = name;
  }
  if (input.species !== undefined) {
    const species = String(input.species).trim().toLowerCase();
    if (!ANIMAL_SPECIES.includes(species)) {
      throw new AppError(400, 'INVALID_SPECIES', `species must be one of: ${ANIMAL_SPECIES.join(', ')}`);
    }
    animal.species = species;
  }
  if (input.gender !== undefined) {
    if (!ANIMAL_GENDERS.includes(input.gender)) {
      throw new AppError(400, 'INVALID_GENDER', `gender must be one of: ${ANIMAL_GENDERS.join(', ')}`);
    }
    animal.gender = input.gender;
  }
  if (input.status !== undefined) {
    if (!ANIMAL_STATUSES.includes(input.status)) {
      throw new AppError(400, 'INVALID_STATUS', `status must be one of: ${ANIMAL_STATUSES.join(', ')}`);
    }
    animal.status = input.status;
  }
  if (input.breedLabel !== undefined) animal.breedLabel = String(input.breedLabel).trim();
  if (input.animalBreedId !== undefined) {
    animal.animalBreedId = input.animalBreedId || undefined;
  }
  if (input.birthDate !== undefined) {
    animal.birthDate = parseBusinessDate(input.birthDate, { field: 'birthDate', required: false });
  }
  if (input.tagCode !== undefined) animal.tagCode = String(input.tagCode).trim();
  if (input.notes !== undefined) animal.notes = String(input.notes).trim();
  if (input.photoUrl !== undefined) animal.photoUrl = String(input.photoUrl).trim();

  await animal.save();
  return publicAnimal(animal);
}

export async function assertAnimalInFarm(animalId, farmerProfileId) {
  const animal = await Animal.findById(animalId);
  if (!animal) throw new AppError(404, 'ANIMAL_NOT_FOUND', 'Animal not found');
  if (String(animal.farmerProfileId) !== String(farmerProfileId)) {
    throw new AppError(403, 'ANIMAL_SCOPE_MISMATCH', 'Animal does not belong to this farm');
  }
  return animal;
}

export { publicAnimal, ANIMAL_SPECIES, ANIMAL_GENDERS, ANIMAL_STATUSES };
