// MaziwaSmart 2.0 environment configuration.
// Secret values must come from the environment or an untracked .env file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../.env') });

const NODE_ENV = process.env.NODE_ENV || 'development';
const isProd = NODE_ENV === 'production';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`[config] ${name} is required; configure it in .env or the process environment.`);
  return value;
}

function optional(name) {
  const value = process.env[name]?.trim();
  return value || undefined;
}

const rawPort = process.env.PORT || '4000';
const PORT = Number.parseInt(rawPort, 10);
if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
  throw new Error('[config] PORT must be an integer between 1 and 65535.');
}

const rawProxyHops = process.env.TRUST_PROXY_HOPS || '1';
const TRUST_PROXY_HOPS = Number.parseInt(rawProxyHops, 10);
if (!Number.isInteger(TRUST_PROXY_HOPS) || TRUST_PROXY_HOPS < 0) {
  throw new Error('[config] TRUST_PROXY_HOPS must be a non-negative integer.');
}

export const env = {
  NODE_ENV,
  PORT,
  FRONTEND_URL: (optional('FRONTEND_URL') || 'http://localhost:5173')
    .split(',').map((origin) => origin.trim().replace(/\/+$/, '')).filter(Boolean).join(','),
  TRUST_PROXY_HOPS,
  MONGO_URI: required('MONGO_URI'),
  REDIS_URL: required('REDIS_URL'),
  SESSION_SECRET: required('SESSION_SECRET'),
  GOOGLE_CLIENT_ID: optional('GOOGLE_CLIENT_ID'),
  GOOGLE_CLIENT_SECRET: optional('GOOGLE_CLIENT_SECRET'),
  GOOGLE_CALLBACK_URL: optional('GOOGLE_CALLBACK_URL'),
  BREVO_API_KEY: optional('BREVO_API_KEY'),
  BREVO_SENDER_EMAIL: optional('BREVO_SENDER_EMAIL'),
  BREVO_SENDER_NAME: optional('BREVO_SENDER_NAME'),
};

export function isCrossSiteFrontend() {
  const origins = String(env.FRONTEND_URL || '').split(',').map((item) => item.trim()).filter(Boolean);
  if (!origins.length) return isProd;
  try {
    return origins.some((origin) => {
      const hostname = new URL(origin).hostname;
      return hostname !== 'localhost' && hostname !== '127.0.0.1' && hostname !== '::1';
    });
  } catch {
    return isProd;
  }
}

export const isProduction = isProd;
