/**
 * Public-safe projection for LivestockAd.
 * Must not expose advertiser internal keys, farmer ownership keys, grants, or account PII.
 */
export function toPublicAdDto(ad) {
  if (!ad) return null;
  const id = String(ad._id || ad.id);
  return {
    id,
    title: ad.title,
    description: ad.description || '',
    species: ad.species,
    price: ad.price,
    currency: ad.currency || 'KES',
    location: ad.location || '',
    images: (ad.images || []).map((img) => ({
      url: img.url,
      width: img.width,
      height: img.height,
      format: img.format,
    })),
    status: ad.status,
    attributes: {
      breedLabel: ad.attributes?.breedLabel || null,
      gender: ad.attributes?.gender || null,
      ageText: ad.attributes?.ageText || null,
      stage: ad.attributes?.stage || null,
    },
    publishedAt: ad.publishedAt || null,
    viewCount: ad.viewCount || 0,
    // Deliberately omitted: advertiserAccountId, farmerProfileId, animalId
  };
}

export function toOwnerAdDto(ad) {
  const base = toPublicAdDto(ad);
  if (!base) return null;
  return {
    ...base,
    advertiserAccountId: String(ad.advertiserAccountId),
    farmerProfileId: ad.farmerProfileId ? String(ad.farmerProfileId) : null,
    animalId: ad.animalId ? String(ad.animalId) : null,
    closedAt: ad.closedAt || null,
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}
