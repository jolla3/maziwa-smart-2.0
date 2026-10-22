# Identity integration slice

This slice preserves the legacy backend identity endpoint names under `/api/userAuth` while moving authentication state to the existing HTTP-only `connect.sid` session with CSRF protection.

## Preserved endpoint names

- `POST /register` (legacy default buyer registration)
- `POST /register/seller`
- `POST /register/farmer`
- `POST /login`
- `POST /logout`
- `POST /set-password`
- `POST /forgot-password`
- `POST /reset-password`
- `GET /profile`
- `PATCH /update-profile`
- `GET /google`
- `GET /google/callback`
- `GET /session` and `GET /me` (session-aware helpers for the 2.0 frontend)

The API no longer returns a JWT from login or places one in the Google callback URL. Browser auth uses the server-side session. `/set-password` is available only in the pending Google-onboarding session. The callback sends users to `/set-password` without a credential in the URL; completed sign-ins redirect to `/google-callback`, where the frontend can call `/session` to determine the account role and route.

## Legacy features carried forward

- The Google strategy uses `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and the same `/api/userAuth/google/callback` route. Set `GOOGLE_CALLBACK_URL` to the exact local or deployed callback URL registered with Google. In production, Google sign-in remains unavailable until this URL is explicitly configured; it will not silently fall back to localhost.
- Role selection is limited to buyer, seller, or farmer for self-registration. Existing accounts keep their existing role when they sign in with Google.
- Buyer, seller, and farmer registration endpoints remain available. Farmer profiles receive an eight-digit farmer code on direct registration; a farmer who starts via Google must complete the code during password setup, matching the legacy onboarding path.
- Seller registration creates a `SellerProfile` in `pending` status, corresponding to legacy `is_approved_seller: false`.
- Password setup retains the legacy six-character minimum, while reset-password retains the legacy eight-character minimum. Forgot-password and reset-password retain their route names. Reset tokens are random, stored hashed, expire after one hour, and are single-use. Password reset increments `sessionVersion` so previously issued sessions stop authenticating.
- The existing Brevo transactional-email integration is used for seller/farmer registration and new Google-account welcome emails, plus password-reset emails, via `BREVO_API_KEY`. Email configuration is optional at startup; password-reset requests remain generic if email cannot be sent.

## Important implementation boundary

This is a clean 2.0 database schema. It does not migrate legacy `User` or `Farmer` documents. `Account`, `FarmerProfile`, and `SellerProfile` are separate models. The Google callback creates only the profile corresponding to the selected role, never both profiles by default.

The legacy frontend is not yet ported. Its current Google callback and auth context expect JWTs in URLs and `localStorage`; do not connect those components unchanged. A 2.0 frontend must use credentialed requests and echo the `X-CSRF-Token` response header on state-changing requests, then call `/api/userAuth/session` to resolve authentication state.

## Environment variables

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_CALLBACK_URL` (optional locally; set explicitly for deployed environments)
- `BREVO_API_KEY`
- `BREVO_SENDER_EMAIL` (optional, default matches the legacy sender)
- `BREVO_SENDER_NAME` (optional)

No secrets belong in `.env.example` or in Git.

## Verification scope

The new unit tests cover input validation, session creation/destruction at the controller boundary, and CSRF token matching. They do not substitute for integration tests against MongoDB, Redis, real Google OAuth credentials, or the Brevo service. Before production use, add integration tests for login/session regeneration, logout invalidation, CSRF rejection, OAuth state mismatch, pending password setup, expired/used reset tokens, and session-version invalidation.
