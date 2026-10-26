# Phase E — Farm Recording & Marketplace API Contracts

Source of truth: `feature/maziwa-smart-2.0-product-build` implementation under `src/modules/*`.
Auth: HTTP-only session cookie + CSRF header (`X-CSRF-Token`) on unsafe methods. No localStorage JWT.

## Public marketplace (no auth)

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/v1/marketplace` | Paginated published ads only. Query: `page`, `limit`, `species`, `location`, `minPrice`, `maxPrice`, `q`. Response: `data.items` |
| GET | `/api/v1/marketplace/:adId` | Public DTO under `data.ad`; 404 if not published |
| POST | `/api/v1/marketplace/:adId/views` | Public view increment |

Public DTO excludes `advertiserAccountId`, `createdByAccountId`, `farmerProfileId`.

## Seller marketplace (auth + CSRF on mutations)

| Method | Path | Rules |
|--------|------|--------|
| GET | `/api/v1/marketplace/me/listings` | `data.ads` — owned or grant-managed |
| POST | `/api/v1/marketplace` | multipart `images`; `publish=true` requires verified seller (`SELLER_NOT_VERIFIED` → 403) |
| PATCH | `/api/v1/marketplace/:adId` | Owner or `marketplace.manage_farmer_ads` |
| POST | `/api/v1/marketplace/:adId/archive` | Same authorization |

## Identity registration (relevant fields)

| Path | Required body |
|------|----------------|
| `POST /api/userAuth/register/farmer` | `email`, `password`, `fullname`, `phone` |
| `POST /api/userAuth/register/seller` | `email`, `password`, `username` |

## Farmers / sellers me

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/v1/farmers/me` | `data.profile` (`id`, `fullName`, …) |
| GET | `/api/v1/sellers/me` | `data.profile` (`id`, `verificationStatus`, …) |

## Media

- Cloudinary: `CLOUD_NAME`, `CLOUD_KEY`, `CLOUD_SECRET`
- Folder prefix: `maziwasmart/{folder}`
- Multer: 10 MB, max 10 images

When Cloudinary is unconfigured, `makeUploader` returns middleware that responds with `503 CLOUDINARY_NOT_CONFIGURED`.

## Source-review note

`createAd` accepts `input.images` when middleware metadata is empty. Clients must not rely on bypassing Multer with a client-supplied images array; product tests exercise the upload middleware path.

## Out of scope

Porter milk collection, payments, chatbot, messaging product work, full frontend.

## Favourites (persisted, session-owned)

**Module:** `src/modules/favourites/`
**Reuse:** marketplace public visibility via `getPublicAdDtoIfPublished` / `mapPublishedPublicAdsByIds` (no private ownership fields).

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/v1/favourites?page&limit` | `requireAuth` | Default page=1 limit=20 max 50. Returns `{ items, page, limit, total, totalPages }`. Items: `{ livestockAdId, savedAt, availability, ad }`. Unavailable ads: `ad: null`. |
| PUT | `/api/v1/favourites/:livestockAdId` | `requireAuth` + CSRF | Only currently **published** ads. Atomic upsert. HTTP 200 `{ livestockAdId, saved: true, savedAt }` for new or existing. 404 if not publicly saveable. |
| DELETE | `/api/v1/favourites/:livestockAdId` | `requireAuth` + CSRF | Idempotent. Account-scoped. Allowed even if ad archived/deleted. `{ livestockAdId, saved: false }`. |

Ownership is always `req.account` from the session — never body/query `accountId`.
