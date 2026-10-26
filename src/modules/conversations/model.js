import mongoose from 'mongoose';

export const CONVERSATION_CONTEXTS = ['direct', 'livestock_ad'];
export const MESSAGE_SIDE_EFFECT_STATUSES = ['pending', 'completed'];

const readCursorSchema = new mongoose.Schema({
  accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  lastReadMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
  lastReadAt: { type: Date, required: true },
}, { _id: false });

const conversationSchema = new mongoose.Schema({
  participantAccountIds: {
    type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true }],
    validate: { validator(v) { return Array.isArray(v) && v.length === 2; }, message: 'Exactly two participants' },
    required: true,
  },
  participantKey: { type: String, required: true, index: true },
  contextType: { type: String, enum: CONVERSATION_CONTEXTS, required: true },
  livestockAdId: { type: mongoose.Schema.Types.ObjectId, ref: 'LivestockAd', default: null },
  createdByAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true },
  lastMessageAt: { type: Date, default: null },
  lastMessageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', default: null },
  lastMessagePreview: { type: String, default: '', maxlength: 280 },
  lastMessageSenderAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', default: null },
  readCursors: { type: [readCursorSchema], default: [] },
}, { timestamps: true });

conversationSchema.index({ participantKey: 1, contextType: 1, livestockAdId: 1 }, { unique: true });
conversationSchema.index({ participantAccountIds: 1, lastMessageAt: -1 });

const messageSchema = new mongoose.Schema({
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  senderAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  body: { type: String, required: true, maxlength: 2000 },
  clientMessageId: { type: String, required: true, maxlength: 128, trim: true },
  sideEffectsStatus: { type: String, enum: MESSAGE_SIDE_EFFECT_STATUSES, default: 'pending', index: true },
  sideEffectsAttempts: { type: Number, default: 0, min: 0 },
  sideEffectsNextAttemptAt: { type: Date, default: null, index: true },
}, { timestamps: true });

messageSchema.index({ conversationId: 1, senderAccountId: 1, clientMessageId: 1 }, { unique: true });
messageSchema.index({ conversationId: 1, createdAt: -1, _id: -1 });
messageSchema.index({ sideEffectsStatus: 1, createdAt: 1 });
messageSchema.index({ sideEffectsStatus: 1, sideEffectsNextAttemptAt: 1, createdAt: 1 });

export const Conversation = mongoose.models.Conversation || mongoose.model('Conversation', conversationSchema);
export const Message = mongoose.models.Message || mongoose.model('Message', messageSchema);
