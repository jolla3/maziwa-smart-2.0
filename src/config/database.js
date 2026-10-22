// Mongoose connection lifecycle, kept separate from Express assembly.
import mongoose from 'mongoose';
import { env } from './environment.js';
import { logger } from './logger.js';

let connected = false;

export async function connectDatabase() {
  mongoose.connection.on('error', (err) => logger.error({ error: err.message }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => {
    connected = false;
    logger.warn('MongoDB disconnected');
  });
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 8000 });
  connected = true;
  logger.info('Connected to MongoDB');
}

export function isDatabaseReady() {
  return connected && mongoose.connection.readyState === 1;
}

export async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) await mongoose.disconnect();
  connected = false;
}
