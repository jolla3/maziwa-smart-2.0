import mongoose from 'mongoose';

const HEALTH_EVENT_TYPES = [
  'checkup',
  'vaccination',
  'treatment',
  'diagnosis',
  'injury',
  'other',
];

const animalHealthRecordSchema = new mongoose.Schema({
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
  eventType: {
    type: String,
    enum: HEALTH_EVENT_TYPES,
    required: true,
  },
  eventDate: { type: Date, required: true, index: true },
  title: { type: String, required: true, trim: true },
  diagnosis: { type: String, trim: true },
  treatment: { type: String, trim: true },
  medication: { type: String, trim: true },
  veterinarian: { type: String, trim: true },
  notes: { type: String, trim: true },
  recordedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
}, { timestamps: true });

animalHealthRecordSchema.index({ animalId: 1, eventDate: -1 });
animalHealthRecordSchema.index({ farmerProfileId: 1, eventDate: -1 });

export const AnimalHealthRecord = mongoose.models.AnimalHealthRecord
  || mongoose.model('AnimalHealthRecord', animalHealthRecordSchema);
export { HEALTH_EVENT_TYPES };
