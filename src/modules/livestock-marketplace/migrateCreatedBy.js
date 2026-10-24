/**
 * createdByAccountId migration helpers.
 *
 * Domain meaning:
 * - advertiserAccountId = Account acting as seller/advertiser of record (publish eligibility).
 * - createdByAccountId  = Account that originally created the row (audit only).
 * These are independent. A delegated manager may create a farm-scoped ad; the
 * advertiser of record may be a different account. Therefore advertiserAccountId
 * must NEVER be copied into createdByAccountId as a default attribution.
 *
 * Trustworthy basis for backfill:
 * - Only an explicit, already-recorded creator-compatible value on the document
 *   (none exist in current LivestockAd schema beyond createdByAccountId itself).
 * - Legacy documents missing createdByAccountId are reported as
 *   unresolvedAttribution — operators must decide offline; this tool does not invent history.
 *
 * Counts are computed over the full collection sample passed in (or full scan in apply).
 */
export function planCreatedByBackfill(docs = []) {
  const unresolvedAttribution = [];
  const missingAdvertiser = [];
  let existingCreator = 0;
  let scanned = 0;

  for (const doc of docs) {
    scanned += 1;
    if (doc.createdByAccountId != null && doc.createdByAccountId !== '') {
      existingCreator += 1;
      continue;
    }
    // Missing creator: no trustworthy alternate source on the document.
    if (doc.advertiserAccountId == null || doc.advertiserAccountId === '') {
      missingAdvertiser.push({ _id: doc._id, reason: 'missing_createdBy_and_advertiser' });
    } else {
      unresolvedAttribution.push({
        _id: doc._id,
        advertiserAccountId: doc.advertiserAccountId,
        farmerProfileId: doc.farmerProfileId || null,
        reason: 'missing_createdBy_no_trustworthy_attribution_source',
      });
    }
  }

  // Eligible remains empty unless a future approved source field is introduced.
  // Explicit empty list documents that we refuse advertiser→creator substitution.
  const eligible = [];

  return {
    scanned,
    existingCreator,
    eligible,
    eligibleCount: eligible.length,
    unresolvedAttribution,
    unresolvedAttributionCount: unresolvedAttribution.length,
    missingAdvertiser,
    missingAdvertiserCount: missingAdvertiser.length,
    // Intended modifications: only eligible rows (currently always zero by design).
    intendedModifications: eligible.map((row) => ({
      _id: row._id,
      setCreatedByAccountId: row.createdByAccountId,
    })),
  };
}

/**
 * @param {import('mongodb').Collection} collection
 * @param {{ apply?: boolean }} options
 */
export async function applyCreatedByBackfill(collection, { apply = false } = {}) {
  // Full collection scan so existingCreator is accurate (not only missing-creator subset).
  const docs = await collection.find({}, {
    projection: {
      _id: 1,
      createdByAccountId: 1,
      advertiserAccountId: 1,
      farmerProfileId: 1,
    },
  }).toArray();

  const plan = planCreatedByBackfill(docs);

  let modified = 0;
  if (apply && plan.eligible.length > 0) {
    for (const row of plan.eligible) {
      const result = await collection.updateOne(
        {
          _id: row._id,
          $or: [
            { createdByAccountId: { $exists: false } },
            { createdByAccountId: null },
          ],
        },
        { $set: { createdByAccountId: row.createdByAccountId } },
      );
      modified += result.modifiedCount || 0;
    }
  }

  return {
    ...plan,
    apply: Boolean(apply),
    modified,
    note: apply
      ? (modified === 0
        ? 'No rows modified: no trustworthy creator attribution sources on legacy documents.'
        : undefined)
      : 'Dry-run only. Pass --apply to write. Advertiser is never copied to createdBy.',
  };
}

/** Resolve Mongoose model collection name without hard-coding. */
export function resolveLivestockAdCollectionName(LivestockAdModel) {
  if (!LivestockAdModel?.collection?.name) {
    throw new Error('LivestockAd model collection name is unavailable');
  }
  return LivestockAdModel.collection.name;
}
