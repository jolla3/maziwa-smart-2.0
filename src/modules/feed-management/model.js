import mongoose from 'mongoose';

/**
 * Operational feed usage/inventory-style records.
 * Feed spend is NOT written to farm-finance automatically — any expense must be
 * an explicit FarmFinancialEntry (optional relatedFeedRecordId link).
 */
const FEED_RECORD_TYPES = ['purchase_note', 'usage', 'adjustment', 'other'];

const feedRecordSchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  /** Optional animal scope when usage is animal-specific. */
  animalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Animal',
  },
  recordType: {
    type: String,
    enum: FEED_RECORD_TYPES,
    required: true,
  },
  feedName: { type: String, required: true, trim: true },
  quantity: { type: Number, required: true, min: 0 },
  unit: { type: String, required: true, trim: true, default: 'kg' },
  recordDate: { type: Date, required: true, index: true },
  notes: { type: String, trim: true },
  recordedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
}, { timestamps: true });

feedRecordSchema.index({ farmerProfileId: 1, recordDate: -1 });

export const FeedRecord = mongoose.models.FeedRecord
  || mongoose.model('FeedRecord', feedRecordSchema);
export { FEED_RECORD_TYPES };
