import mongoose from 'mongoose';

const ACCOUNT_ROLES = ['buyer', 'seller', 'farmer', 'admin', 'superadmin', 'broker', 'manager'];

const accountSchema = new mongoose.Schema({
  username: { type: String, trim: true, default: '' },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, trim: true },
  location: { type: String, trim: true },
  passwordHash: { type: String, select: false },
  googleId: { type: String, unique: true, sparse: true },
  photo: { type: String, trim: true },
  role: { type: String, enum: ACCOUNT_ROLES, required: true },
  onboardingComplete: { type: Boolean, default: true },
  isActive: { type: Boolean, default: true },
  resetPasswordTokenHash: { type: String, select: false },
  resetPasswordExpiresAt: { type: Date, select: false },
  sessionVersion: { type: Number, default: 0, min: 0 },
}, { timestamps: true, minimize: false });

accountSchema.index({ resetPasswordTokenHash: 1 }, { sparse: true });

export const Account = mongoose.models.Account || mongoose.model('Account', accountSchema);
export { ACCOUNT_ROLES };
