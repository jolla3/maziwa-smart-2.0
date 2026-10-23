import mongoose from 'mongoose';

/**
 * MilkYieldRecord — per-animal production (maps conceptually from legacy CowMilkRecord).
 * Does NOT model legacy porter/cooperative MilkRecord.
 * Litres are production data only — never auto-create finance income.
 */
const TIME_SLOTS = ['morning', 'afternoon', 'evening', 'other'];

const milkYieldRecordSchema = new mongoose.Schema({
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
  /** Calendar business date for the yield (date-only intent; stored as Date). */
  yieldDate: { type: Date, required: true, index: true },
  litres: {
    type: Number,
    required: true,
    min: 0,
  },
  timeSlot: {
    type: String,
    enum: TIME_SLOTS,
    default: 'other',
  },
  notes: { type: String, trim: true },
  recordedByAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
  },
}, { timestamps: true });

milkYieldRecordSchema.index({ animalId: 1, yieldDate: -1 });
milkYieldRecordSchema.index({ farmerProfileId: 1, yieldDate: -1 });

export const MilkYieldRecord = mongoose.models.MilkYieldRecord
  || mongoose.model('MilkYieldRecord', milkYieldRecordSchema);
export { TIME_SLOTS };
