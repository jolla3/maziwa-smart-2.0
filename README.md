# MaziwaSmart 2.0 backend

This is the first local implementation slice. It is a clean working directory, not a remote GitHub repository yet.

## Source provenance

The reusable infrastructure files below were copied from `jolla3/tycoon-estates-backend` at commit `569c96c8f6a017c114e9abbe8b5f15b72d6e934a`, then only import paths were changed where the new folder layout required it:

- Pino logger and redaction configuration
- Helmet/CORS origin allowlisting
- Redis client, bounded Redis health checks and startup gate
- Double-submit/Origin-based CSRF middleware
- Redis-backed fixed-window rate limiter
- Request ID/logging middleware
- Token-matched Redis distributed job lock
- Consistent API response helper

The MaziwaSmart 2.0 wiring added here separates Express app assembly, server startup, MongoDB connection lifecycle, and environment configuration. Mongo-backed HTTP-only sessions use `express-session` + `connect-mongo`, following the tested Tycoon approach. Session cookie lifetime and same-site behaviour currently mirror that baseline; review them against the actual deployment when integrating the frontend.

## Deliberately not included yet

No identity routes or fake login/register handlers, Google OAuth callback, password workflows, Maziwa domain routes, marketplace routes, or Cloudinary upload code are claimed as ported in this slice. They belong in subsequent slices where we can trace their exact source behaviour and preserve their naming/contract.

No `.env` or credentials were copied. Create your own `.env` from `.env.example` and use real service endpoints only in your local environment.

## Run

```bash
cp .env.example .env
# Edit .env with your actual MongoDB URI, Redis URL, and a generated SESSION_SECRET.
npm install
npm test
```

To start the server, MongoDB and Redis must be reachable. In development, Redis readiness is bounded and logs a warning if unavailable; `/ready` remains truthful. Production startup fails if Redis does not become ready, matching the tested Tycoon startup policy.

`GET /health` and `GET /api/v1/health` are liveness checks. `GET /ready` checks MongoDB and Redis. No domain endpoint is exposed yet.

## Next slice

Port identity behaviour from the actual legacy MaziwaSmart source and tested Tycoon session patterns: Google sign-in/callback, password set/forgot/reset, login/logout, and the existing frontend contracts. Preserve actual names and behaviour while applying only the approved 2.0 naming/domain changes.
