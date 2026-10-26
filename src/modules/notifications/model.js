import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  recipientAccountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, index: true },
  messageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Message', required: true },
  conversationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  type: { type: String, required: true, default: 'message', index: true },
  title: { type: String, required: true, maxlength: 200 },
  body: { type: String, required: true, maxlength: 500 },
  readAt: { type: Date, default: null },
}, { timestamps: true });

notificationSchema.index({ recipientAccountId: 1, messageId: 1 }, { unique: true });

export const Notification = mongoose.models.Notification || mongoose.model('Notification', notificationSchema);
