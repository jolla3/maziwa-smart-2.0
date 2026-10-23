import mongoose from 'mongoose';

const BREEDING_EVENT_TYPES = [
  'heat',
  'insemination',
  'natural_service',
  'pregnancy_check',
  'confirmed_pregnant',
  'not_pregnant',
  'calving',
  'abortion',
  'other',
];

const breedingEventSchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  animalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Animal',
    required: true,
    index: true,
  },
  /** Optional second animal (e.g. sire) on the same farm when known. */
  relatedAnimalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Animal',
  },
  eventType: {
    type: String,
    enum: BREEDING_EVENT_TYPES,
    required: true,
  },
  eventDate: { type: Date, required: true, index: true },
  outcome: { type: String, trim: true },
  notes: { type: String, trim: true },
  recordedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
}, { timestamps: true });

breedingEventSchema.index({ animalId: 1, eventDate: -1 });
breedingEventSchema.index({ farmerProfileId: 1, eventDate: -1 });

export const BreedingEvent = mongoose.models.BreedingEvent
  || mongoose.model('BreedingEvent', breedingEventSchema);
export { BREEDING_EVENT_TYPES };
