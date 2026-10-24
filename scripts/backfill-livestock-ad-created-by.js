#!/usr/bin/env node
/**
 * Dry-run by default. Pass --apply to write.
 *
 *   node scripts/backfill-livestock-ad-created-by.js
 *   node scripts/backfill-livestock-ad-created-by.js --apply
 *
 * createdByAccountId is audit-only and independent of advertiserAccountId.
 * This tool does NOT invent creator values from advertiser identity.
 *
 * Uses MONGO_URI from env/.env. Does not print secrets.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { LivestockAd } from '../src/modules/livestock-marketplace/model.js';
import {
  applyCreatedByBackfill,
  resolveLivestockAdCollectionName,
} from '../src/modules/livestock-marketplace/migrateCreatedBy.js';

const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../.env') });

const apply = process.argv.includes('--apply');
const uri = process.env.MONGO_URI;
if (!uri) {
  console.error('MONGO_URI is required (set in environment or .env). No database connection was attempted beyond this check.');
  process.exit(1);
}

const conn = await mongoose.connect(uri);
const collectionName = resolveLivestockAdCollectionName(LivestockAd);
const collection = conn.connection.db.collection(collectionName);

const report = await applyCreatedByBackfill(collection, { apply });

console.log(JSON.stringify({
  mode: apply ? 'apply' : 'dry-run',
  collection: collectionName,
  scanned: report.scanned,
  existingCreator: report.existingCreator,
  eligibleCount: report.eligibleCount,
  unresolvedAttributionCount: report.unresolvedAttributionCount,
  missingAdvertiserCount: report.missingAdvertiserCount,
  modified: report.modified,
  note: report.note,
  // Cap sample ids in CLI output to keep logs small
  unresolvedAttributionSample: (report.unresolvedAttribution || []).slice(0, 20),
  missingAdvertiserSample: (report.missingAdvertiser || []).slice(0, 20),
}, null, 2));

await mongoose.disconnect();
