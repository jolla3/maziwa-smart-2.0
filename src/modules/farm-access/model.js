import mongoose from 'mongoose';

const farmAccessGrantSchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  recipientAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
    index: true,
  },
  permissions: {
    type: [{ type: String, required: true }],
    validate: {
      validator(v) {
        return Array.isArray(v) && v.length > 0;
      },
      message: 'permissions must be a non-empty array',
    },
  },
  status: {
    type: String,
    enum: ['active', 'revoked'],
    default: 'active',
    required: true,
  },
  expiresAt: { type: Date },
  grantedByAccountId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Account',
    required: true,
  },
  revokedAt: { type: Date },
  note: { type: String, trim: true },
}, { timestamps: true });

farmAccessGrantSchema.index(
  { farmerProfileId: 1, recipientAccountId: 1, status: 1 },
);

export const FarmAccessGrant = mongoose.models.FarmAccessGrant
  || mongoose.model('FarmAccessGrant', farmAccessGrantSchema);
