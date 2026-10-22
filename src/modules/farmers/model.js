import mongoose from 'mongoose';

const farmerProfileSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true },
  fullName: { type: String, required: true, trim: true },
  farmerCode: { type: Number, min: 10000000, max: 99999999, unique: true, sparse: true },
  phone: { type: String, trim: true },
  email: { type: String, lowercase: true, trim: true, index: true },
  location: { type: String, trim: true },
  photo: { type: String, trim: true },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

export const FarmerProfile = mongoose.models.FarmerProfile || mongoose.model('FarmerProfile', farmerProfileSchema);
