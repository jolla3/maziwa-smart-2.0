import mongoose from 'mongoose';

/**
 * Favourite — session-owned saved relationship between Account and LivestockAd.
 * Does not store a copy of the ad; listing re-projects public visibility at read time.
 */
const favouriteSchema = new mongoose.Schema(
  {
    accountId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Account',
      required: true,
    },
    livestockAdId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'LivestockAd',
      required: true,
    },
  },
  { timestamps: true },
);

// One save relationship per account+ad
favouriteSchema.index({ accountId: 1, livestockAdId: 1 }, { unique: true });
// Account-scoped list ordered by save time, stable _id tie-break
favouriteSchema.index({ accountId: 1, createdAt: -1, _id: -1 });

export const Favourite =
  mongoose.models.Favourite || mongoose.model('Favourite', favouriteSchema);

export default Favourite;
