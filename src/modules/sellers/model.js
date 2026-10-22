import mongoose from 'mongoose';

const sellerProfileSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  verificationStatus: { type: String, enum: ['pending', 'verified', 'rejected'], default: 'pending', required: true },
  submittedAt: { type: Date, default: Date.now },
  verifiedAt: { type: Date },
}, { timestamps: true });

export const SellerProfile = mongoose.models.SellerProfile || mongoose.model('SellerProfile', sellerProfileSchema);
