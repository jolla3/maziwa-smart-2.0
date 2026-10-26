# Phase E: Farm Recording and Livestock Marketplace

**Status:** In progress; core acceptance paths have passed focused HTTP tests.
**Last verified:** 2026-10-26

## Scope

Phase E covers the farm-recording and public livestock-marketplace product.
Public marketplace browsing must work without authentication. Seller
registration must not automatically grant seller verification.

Out of scope: porter/cooperative milk-collection POS, SMS/WhatsApp features,
and checkout or payment processing.

## Verified behavior

The focused HTTP integration test passed in the actual working repository:

- Anonymous clients can browse the public marketplace.
- Unpublished ads are excluded from public listing and detail responses.
- A farmer can create an animal and a milk-yield record; another farmer
  cannot access those records through the tested ownership boundary.
- A pending seller is blocked from publishing, may create a draft, and a
  verified seller can publish through the tested upload path.
- The publishing service recognizes the multipart string value
  `publish=true`, as well as boolean `true`.

The dedicated two-instance session integration suite also passed in the
actual working repository, covering shared-session behavior, logout
invalidation, account/session-version checks, CSRF enforcement, and readiness.

## Test evidence

| Test run | Result | Environment |
| --- | --- | --- |
| `tests/integration/phase-e-product.http.test.js` | 1 suite, 4 tests passed | Actual working repository |
| `tests/integration/two-instance-session.test.js` | 1 suite, 7 tests passed | Actual working repository |
| Complete Jest regression | 33 suites, 228 tests passed | Isolated candidate snapshot |

Logs from the 2026-10-26 run:

- `~/Downloads/maziwa-phase-e-real-20261026-155436.log`
- `~/Downloads/maziwa-two-instance-real-20261026-155440.log`
- `~/Downloads/maziwa-phase-e-full-candidate-20261026-155443.log`

The full regression result belongs to the isolated candidate snapshot. It is
not a claim that the entire test suite was executed against the actual
working checkout. The candidate excluded `.env`; the Phase E integration test
mocks transactional email and Cloudinary to avoid real external side effects.

## Fixes included

- Normalize the marketplace publish flag so multipart string values such as
  `true` are recognized.
- Add Phase E HTTP integration coverage and API contract documentation.
- Assign an isolated rate-limit key namespace to the two-instance session
  test, shared by both app instances during that test.

## Acceptance gaps still to close

1. **Manager permissions:** exercise manager grants through HTTP, including
   allowed and denied cross-farm operations and grant boundaries.
2. **Seller verification:** verify the operator verification endpoint,
   authorization rules, and state transitions over HTTP.
3. **Marketplace discovery:** test search, filters, pagination, and invalid
   query handling, if exposed by the API contract.
4. **Listing lifecycle:** verify edit, private/draft visibility, list-mine
   ownership, close/archive behavior, and forbidden cross-owner operations.
5. **Real media integration:** verify Cloudinary credentials/configuration,
   file type and size limits, maximum image count, and cleanup/error handling
   using a controlled integration environment.
6. **Farm-recording acceptance:** map each supported farm-recording module to
   its actual HTTP routes and verify create/read/update/delete permissions
   and relevant validation rules at the API boundary.
7. **Product integration:** verify that the frontend consumes the implemented
   contracts and that the core farm and marketplace journeys work in the UI.
8. **External identity and email:** test OAuth and transactional-email
   provider behavior separately from isolated automated tests.
9. **Legacy comparison:** complete the planned legacy-repository comparison
   before claiming feature parity with the previous product.

## Completion rule

Do not mark Phase E complete solely because unit tests or mocked HTTP tests
pass. Close the remaining acceptance gaps with explicit evidence, rerun the
appropriate regression suite, and reconcile the project README and build
status with the verified implementation.

### Favourites (persisted)
- Status: **implemented** (session-owned MongoDB Favourite model; isolated regression verification passed).
- Legacy localStorage wishlist approaches: **replaced** (not ported).
- Basket/checkout: **excluded**.
