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
 * LivestockAd — public marketplace advertisement (legacy Listing concept).
 * Not a sale/checkout record. Optional animalId when livestock is registered.
 */
const livestockAdSchema = new mongoose.Schema({
  advertiserAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
    index: true,
  },
  /** Optional farmer scope when ad is for a farmer-owned registered animal. */
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
  /** Public-facing attributes (age, breed text, sex) — not private farm keys. */
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
