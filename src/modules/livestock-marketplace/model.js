import mongoose from 'mongoose';

const AD_STATUSES = ['draft', 'published', 'closed', 'archived'];
const SPECIES = ['cow', 'goat', 'sheep', 'pig', 'other'];

const imageSchema = new mongoose.Schema({
  url: { type: String, required: true },
  publicId: { type: String },
  width: { type: Number },
  height: { type: Number },
  format: { type: String },
  bytes: { type: Number },
}, { _id: false });

/**
 * LivestockAd — public marketplace advertisement (not checkout/sale).
 *
 * Identity fields:
 * - advertiserAccountId: Account acting as seller/advertiser of record (publish eligibility).
 * - createdByAccountId: Account that created the row (audit). Optional for legacy rows until backfill.
 * - farmerProfileId: Farm scope when representing a farmer's livestock.
 * - animalId: Optional registered Animal in that farm scope.
 *
 * Management authorization is NOT "advertiserAccountId === actor" for farm-scoped ads.
 * See service assertCanManageAd.
 */
const livestockAdSchema = new mongoose.Schema({
  advertiserAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
    index: true,
  },
  /** Audit: who created the record. Not required so pre-migration docs still load/save. */
  createdByAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    index: true,
  },
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    index: true,
  },
  animalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Animal',
    index: true,
  },
  title: { type: String, required: true, trim: true, maxlength: 200 },
  description: { type: String, trim: true, maxlength: 5000, default: '' },
  species: { type: String, enum: SPECIES, required: true, index: true },
  price: { type: Number, required: true, min: 0 },
  currency: { type: String, required: true, uppercase: true, default: 'KES' },
  location: { type: String, trim: true, default: '' },
  images: { type: [imageSchema], default: [] },
  status: { type: String, enum: AD_STATUSES, default: 'draft', index: true },
  attributes: {
    breedLabel: { type: String, trim: true },
    gender: { type: String, enum: ['female', 'male', 'unknown'] },
    ageText: { type: String, trim: true },
    stage: { type: String, trim: true },
  },
  publishedAt: { type: Date },
  closedAt: { type: Date },
  viewCount: { type: Number, default: 0, min: 0 },
}, { timestamps: true });

livestockAdSchema.index({ status: 1, publishedAt: -1 });
livestockAdSchema.index({ status: 1, species: 1, price: 1 });
livestockAdSchema.index({ title: 'text', description: 'text', location: 'text' });

const adViewEventSchema = new mongoose.Schema({
  livestockAdId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'LivestockAd',
    required: true,
    index: true,
  },
  viewerAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
  viewedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

export const LivestockAd = mongoose.models.LivestockAd
  || mongoose.model('LivestockAd', livestockAdSchema);
export const AdViewEvent = mongoose.models.AdViewEvent
  || mongoose.model('AdViewEvent', adViewEventSchema);
export { AD_STATUSES, SPECIES };
