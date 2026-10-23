import mongoose from 'mongoose';

/**
 * FarmFinancialEntry — explicit income or expense only.
 * Never created automatically from milk yields, ads, or animal counts.
 */
const ENTRY_TYPES = ['income', 'expense'];

const farmFinancialEntrySchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  entryType: {
    type: String,
    enum: ENTRY_TYPES,
    required: true,
    index: true,
  },
  /** Positive monetary amount in the stated currency. */
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  /** Explicit currency code (e.g. KES). Totals must not mix currencies silently. */
  currency: {
    type: String,
    required: true,
    trim: true,
    uppercase: true,
    default: 'KES',
  },
  /** Human category label (approved closed set still product-open; free text allowed). */
  category: {
    type: String,
    required: true,
    trim: true,
  },
  description: { type: String, trim: true },
  /** Business/occurrence date of the transaction. */
  entryDate: { type: Date, required: true, index: true },
  /** Optional operational links — informational only; never auto-derived amounts. */
  animalId: { type: mongoose.Schema.Types.ObjectId, ref: 'Animal' },
  relatedFeedRecordId: { type: mongoose.Schema.Types.ObjectId, ref: 'FeedRecord' },
  recordedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  status: {
    type: String,
    enum: ['posted', 'void'],
    default: 'posted',
  },
}, { timestamps: true });

farmFinancialEntrySchema.index({ farmerProfileId: 1, entryDate: -1 });
farmFinancialEntrySchema.index({ farmerProfileId: 1, entryType: 1, currency: 1 });

export const FarmFinancialEntry = mongoose.models.FarmFinancialEntry
  || mongoose.model('FarmFinancialEntry', farmFinancialEntrySchema);
export { ENTRY_TYPES };
