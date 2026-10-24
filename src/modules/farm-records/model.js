import mongoose from 'mongoose';

/**
 * Custom farm records — farmer-defined forms and entries.
 * Supported field types are intentionally small until schema/API phase expands them.
 * Attachments / executable expressions are not supported.
 */
export const CUSTOM_FIELD_TYPES = Object.freeze(['string', 'number', 'boolean', 'date']);

const fieldDefSchema = new mongoose.Schema({
  key: { type: String, required: true, trim: true },
  label: { type: String, trim: true },
  type: { type: String, enum: CUSTOM_FIELD_TYPES, required: true },
  required: { type: Boolean, default: false },
}, { _id: false });

const customRecordDefinitionSchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  fields: { type: [fieldDefSchema], default: [] },
  isActive: { type: Boolean, default: true },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
}, { timestamps: true });

customRecordDefinitionSchema.index({ farmerProfileId: 1, name: 1 });

const customRecordEntrySchema = new mongoose.Schema({
  farmerProfileId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'FarmerProfile',
    required: true,
    index: true,
  },
  definitionId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'CustomRecordDefinition',
    required: true,
    index: true,
  },
  animalId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Animal',
  },
  /** Validated against definition.fields; Mixed map keyed by field key. */
  values: { type: mongoose.Schema.Types.Mixed, default: {} },
  recordDate: { type: Date, required: true, index: true },
  notes: { type: String, trim: true },
  recordedByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account' },
}, { timestamps: true });

customRecordEntrySchema.index({ definitionId: 1, recordDate: -1 });
customRecordEntrySchema.index({ farmerProfileId: 1, recordDate: -1 });

export const CustomRecordDefinition = mongoose.models.CustomRecordDefinition
  || mongoose.model('CustomRecordDefinition', customRecordDefinitionSchema);
export const CustomRecordEntry = mongoose.models.CustomRecordEntry
  || mongoose.model('CustomRecordEntry', customRecordEntrySchema);
