import mongoose from 'mongoose';

const ANIMAL_SPECIES = ['cow', 'goat', 'sheep', 'pig', 'other'];
const ANIMAL_GENDERS = ['female', 'male', 'unknown'];
const ANIMAL_STATUSES = ['active', 'sold', 'deceased', 'inactive'];

const animalBreedSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  species: { type: String, enum: ANIMAL_SPECIES, required: true },
  notes: { type: String, trim: true },
}, { timestamps: true });

animalBreedSchema.index({ species: 1, name: 1 }, { unique: true });

const animalSchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  species: { type: String, enum: ANIMAL_SPECIES, required: true },
  gender: { type: String, enum: ANIMAL_GENDERS, default: 'unknown' },
  breedLabel: { type: String, trim: true, default: '' },
  animalBreedId: { type: mongoose.Schema.Types.ObjectId, ref: 'AnimalBreed' },
  birthDate: { type: Date },
  status: { type: String, enum: ANIMAL_STATUSES, default: 'active' },
  tagCode: { type: String, trim: true },
  notes: { type: String, trim: true },
  photoUrl: { type: String, trim: true },
}, { timestamps: true });

animalSchema.index({ farmerProfileId: 1, name: 1 });
animalSchema.index({ farmerProfileId: 1, status: 1 });

export const AnimalBreed = mongoose.models.AnimalBreed
  || mongoose.model('AnimalBreed', animalBreedSchema);
export const Animal = mongoose.models.Animal
  || mongoose.model('Animal', animalSchema);
export { ANIMAL_SPECIES, ANIMAL_GENDERS, ANIMAL_STATUSES };
