/**
 * Phase E product workflows (HTTP) — farm recording + public marketplace.
 *
 * - Anonymous public marketplace browse/detail and draft privacy
 * - Farmer registration + animals/milk with cross-farmer denial
 * - Seller pending vs verified publish gate (fixture update is not operator-API coverage)
 *
 * Cloudinary is mocked before createApp so marketplace POSTs do not 503.
 * Uses MongoMemoryServer only; no production database.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from '@jest/globals';
import { Writable } from 'node:stream';
import mongoose from 'mongoose';
import request from 'supertest';

const SUITE_DB = 'maziwa_phase_e_product';
const TEST_ORIGIN = 'http://localhost:5173';

let memoryServer = null;
let app;
let Account;
let SellerProfile;
let LivestockAd;
let FarmAccessGrant;

/** Minimal JPEG bytes (valid enough for multipart mimetype image/jpeg). */
const FAKE_JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xff, 0xd9,
]);

function extractCookies(res) {
  const raw = res.headers['set-cookie'] || [];
  const list = Array.isArray(raw) ? raw : [raw];
  const jar = {};
  for (const line of list) {
    if (!line) continue;
    const [pair] = String(line).split(';');
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    jar[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return jar;
}

function cookieHeader(jar) {
  return Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ');
}

function mergeCookies(target, res) {
  return { ...target, ...extractCookies(res) };
}

function errorCode(res) {
  return res.body?.error?.code || res.body?.code || null;
}

/**
 * Register via a specific identity path. Does not fall back to another role
 * when registration fails — throws with status and body for diagnosis.
 */
async function registerAndLogin(path, body) {
  let jar = {};
  const probe = await request(app).get('/api/userAuth/session').set('Origin', TEST_ORIGIN);
  jar = mergeCookies(jar, probe);
  let csrf = jar['csrf-token'] || probe.headers['x-csrf-token'];
  expect(csrf).toBeTruthy();

  const reg = await request(app)
    .post(`/api/userAuth/${path}`)
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send(body);
  jar = mergeCookies(jar, reg);
  csrf = jar['csrf-token'] || csrf;

  if (![200, 201].includes(reg.status)) {
    throw new Error(
      `${path} failed HTTP ${reg.status}: ${JSON.stringify(reg.body)}`,
    );
  }

  const login = await request(app)
    .post('/api/userAuth/login')
    .set('Cookie', cookieHeader(jar))
    .set('X-CSRF-Token', csrf)
    .set('Origin', TEST_ORIGIN)
    .send({ email: body.email, password: body.password });
  jar = mergeCookies(jar, login);
  csrf = jar['csrf-token'] || csrf;

  if (login.status !== 200) {
    throw new Error(
      `login failed HTTP ${login.status}: ${JSON.stringify(login.body)}`,
    );
  }

  return {
    jar,
    csrf,
    cookie: cookieHeader(jar),
    registerBody: reg.body,
    loginBody: login.body,
  };
}

beforeAll(async () => {
  process.env.NODE_ENV = 'test';
  // Isolate real Redis rate-limit counters from other Jest suites.
  process.env.RATE_LIMIT_KEY_NAMESPACE =
    `jest-phase-e-${process.pid}-${Date.now()}`;
  process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'phase-e-session-secret';
  process.env.FRONTEND_URL = TEST_ORIGIN;
  process.env.REDIS_URL = process.env.REDIS_URL || 'redis://127.0.0.1:6379';
  // Ensure makeUploader does not short-circuit on missing env before mock applies.
  process.env.CLOUD_NAME = process.env.CLOUD_NAME || 'test-cloud';
  process.env.CLOUD_KEY = process.env.CLOUD_KEY || 'test-key';
  process.env.CLOUD_SECRET = process.env.CLOUD_SECRET || 'test-secret';

  // Tests must not send transactional email through real provider credentials.
  jest.unstable_mockModule('../../src/modules/identity/emailService.js', () => ({
    sendWelcomeEmail: jest.fn(async () => ({ success: true })),
    sendPasswordResetEmail: jest.fn(async () => ({ success: true })),
  }));

  jest.unstable_mockModule('../../src/integrations/media-storage/cloudinary.js', () => ({
    isCloudinaryConfigured: () => true,
    getCloudinary: () => ({
      uploader: {
        upload_stream(options, callback) {
          const writable = new Writable({
            write(_chunk, _enc, next) {
              next();
            },
          });
          queueMicrotask(() => {
            callback(null, {
              secure_url: 'https://res.cloudinary.com/test/image/upload/v1/maziwasmart/listings/fake.jpg',
              public_id: options?.public_id || 'maziwasmart/listings/fake',
              width: 100,
              height: 80,
              format: 'jpg',
              bytes: FAKE_JPEG.length,
              resource_type: 'image',
            });
          });
          return writable;
        },
        destroy: async () => ({ result: 'ok' }),
      },
    }),
    destroyCloudinaryAsset: async () => ({ result: 'ok' }),
  }));

  const { MongoMemoryServer } = await import('mongodb-memory-server');
  memoryServer = await MongoMemoryServer.create();
  const uri = memoryServer.getUri(SUITE_DB);
  process.env.MONGO_URI = uri;

  const envMod = await import('../../src/config/environment.js');
  if (envMod.env) {
    envMod.env.MONGO_URI = uri;
    envMod.env.FRONTEND_URL = TEST_ORIGIN;
    envMod.env.SESSION_SECRET = process.env.SESSION_SECRET;
    envMod.env.CLOUD_NAME = process.env.CLOUD_NAME;
    envMod.env.CLOUD_KEY = process.env.CLOUD_KEY;
    envMod.env.CLOUD_SECRET = process.env.CLOUD_SECRET;
  }

  await mongoose.connect(uri);
  const { createApp } = await import('../../src/app.js');
  app = createApp();
  ({ Account } = await import('../../src/modules/identity/model.js'));
  ({ SellerProfile } = await import('../../src/modules/sellers/model.js'));
  ({ LivestockAd } = await import('../../src/modules/livestock-marketplace/model.js'));
  ({ FarmAccessGrant } = await import('../../src/modules/farm-access/model.js'));
}, 120_000);

afterAll(async () => {
  const errors = [];
  try {
    const { disposeAppResources } = await import('../../src/app.js');
    if (app) await disposeAppResources(app);
  } catch (err) {
    errors.push(`disposeAppResources: ${err.message}`);
  }
  try {
    const redisMod = await import('../../src/config/redis.js');
    if (typeof redisMod.disconnectRedis === 'function') {
      await redisMod.disconnectRedis();
    }
  } catch (err) {
    errors.push(`redis: ${err.message}`);
  }
  try {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  } catch (err) {
    errors.push(`mongoose: ${err.message}`);
  }
  try {
    if (memoryServer) {
      await memoryServer.stop();
      memoryServer = null;
    }
  } catch (err) {
    errors.push(`memoryServer: ${err.message}`);
  }
  if (errors.length) {
    // Surface cleanup problems without converting them into a silent pass.
    // eslint-disable-next-line no-console
    console.warn('Phase E teardown warnings:', errors.join('; '));
  }
});

beforeEach(async () => {
  if (Account) await Account.deleteMany({});
  if (SellerProfile) await SellerProfile.deleteMany({});
  if (LivestockAd) await LivestockAd.deleteMany({});
  if (FarmAccessGrant) await FarmAccessGrant.deleteMany({});
  try {
    const { Animal } = await import('../../src/modules/animals/model.js');
    const { MilkYieldRecord } = await import('../../src/modules/milk-production/model.js');
    const { FarmerProfile } = await import('../../src/modules/farmers/model.js');
    await Animal.deleteMany({});
    await MilkYieldRecord.deleteMany({});
    await FarmerProfile.deleteMany({});
  } catch {
    /* models may not be loaded yet on first import failure paths */
  }
});

describe('Phase E: public marketplace (anonymous)', () => {
  test('GET /api/v1/marketplace does not require authentication', async () => {
    const res = await request(app).get('/api/v1/marketplace').set('Origin', TEST_ORIGIN);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data?.items)).toBe(true);
  });

  test('unpublished ads are excluded from public list and detail', async () => {
    const account = await Account.create({
      username: 'seller_pub',
      email: 'seller_pub@example.test',
      passwordHash: 'x',
      role: 'seller',
      isActive: true,
    });
    await SellerProfile.create({
      accountId: account._id,
      verificationStatus: 'verified',
    });
    const draft = await LivestockAd.create({
      title: 'Draft cow',
      species: 'cow',
      price: 1000,
      currency: 'KES',
      status: 'draft',
      advertiserAccountId: account._id,
      createdByAccountId: account._id,
    });
    const published = await LivestockAd.create({
      title: 'Public cow',
      species: 'cow',
      price: 2000,
      currency: 'KES',
      status: 'published',
      publishedAt: new Date(),
      advertiserAccountId: account._id,
      createdByAccountId: account._id,
    });

    const list = await request(app).get('/api/v1/marketplace').set('Origin', TEST_ORIGIN);
    expect(list.status).toBe(200);
    const items = list.body.data.items;
    expect(Array.isArray(items)).toBe(true);
    const ids = items.map((i) => String(i.id));
    expect(ids).toContain(String(published._id));
    expect(ids).not.toContain(String(draft._id));

    const detailDraft = await request(app)
      .get(`/api/v1/marketplace/${draft._id}`)
      .set('Origin', TEST_ORIGIN);
    expect(detailDraft.status).toBe(404);

    const detailPub = await request(app)
      .get(`/api/v1/marketplace/${published._id}`)
      .set('Origin', TEST_ORIGIN);
    expect(detailPub.status).toBe(200);
    const ad = detailPub.body.data.ad;
    expect(ad.title).toBe('Public cow');
    expect(ad.advertiserAccountId).toBeUndefined();
    expect(ad.createdByAccountId).toBeUndefined();
    expect(ad.farmerProfileId).toBeUndefined();
  });
});

describe('Phase E: farmer farm recording ownership', () => {
  test('farmer can create animal and milk yield; other farmer is denied', async () => {
    const ts = Date.now();
    const a = await registerAndLogin('register/farmer', {
      email: `farm-a-${ts}@example.test`,
      password: 'TestPass1!',
      fullname: `Farmer A ${ts}`,
      phone: `2547${String(ts).slice(-8)}`,
    });
    const b = await registerAndLogin('register/farmer', {
      email: `farm-b-${ts}@example.test`,
      password: 'TestPass1!',
      fullname: `Farmer B ${ts}`,
      phone: `2548${String(ts).slice(-8)}`,
    });

    const meA = await request(app)
      .get('/api/v1/farmers/me')
      .set('Cookie', a.cookie)
      .set('Origin', TEST_ORIGIN);
    expect(meA.status).toBe(200);
    const farmerAId = meA.body?.data?.profile?.id;
    expect(farmerAId).toBeTruthy();

    const meB = await request(app)
      .get('/api/v1/farmers/me')
      .set('Cookie', b.cookie)
      .set('Origin', TEST_ORIGIN);
    expect(meB.status).toBe(200);
    expect(meB.body?.data?.profile?.id).toBeTruthy();

    const createAnimal = await request(app)
      .post('/api/v1/animals')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ name: 'Bessie', species: 'cow', gender: 'female' });
    expect(createAnimal.status).toBe(201);
    const animalId = createAnimal.body?.data?.animal?.id;
    expect(animalId).toBeTruthy();

    const yieldRes = await request(app)
      .post('/api/v1/milk-yields')
      .set('Cookie', a.cookie)
      .set('X-CSRF-Token', a.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        animalId,
        litres: 12.5,
        yieldDate: '2026-10-20',
        timeSlot: 'morning',
      });
    expect(yieldRes.status).toBe(201);
    expect(yieldRes.body?.data?.record?.litres).toBe(12.5);

    const crossAnimal = await request(app)
      .get(`/api/v1/animals/${animalId}`)
      .set('Cookie', b.cookie)
      .set('Origin', TEST_ORIGIN);
    expect([403, 404]).toContain(crossAnimal.status);

    const crossYield = await request(app)
      .post('/api/v1/milk-yields')
      .set('Cookie', b.cookie)
      .set('X-CSRF-Token', b.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        animalId,
        farmerProfileId: farmerAId,
        litres: 1,
        yieldDate: '2026-10-21',
        timeSlot: 'morning',
      });
    expect([403, 404]).toContain(crossYield.status);
  });
});

describe('Phase E: seller verification gate on publish', () => {
  test('pending seller cannot publish; draft allowed; verified can publish with upload', async () => {
    const ts = Date.now();
    const s = await registerAndLogin('register/seller', {
      email: `sell-${ts}@example.test`,
      password: 'TestPass1!',
      username: `sell_${ts}`,
    });

    const me = await request(app)
      .get('/api/v1/sellers/me')
      .set('Cookie', s.cookie)
      .set('Origin', TEST_ORIGIN);
    expect(me.status).toBe(200);
    const profile = me.body?.data?.profile;
    expect(profile?.id).toBeTruthy();
    expect(profile.verificationStatus).toBe('pending');

    const publishAttempt = await request(app)
      .post('/api/v1/marketplace')
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', TEST_ORIGIN)
      .field('title', 'Should fail publish')
      .field('species', 'cow')
      .field('price', '5000')
      .field('publish', 'true')
      .attach('images', FAKE_JPEG, { filename: 'cow.jpg', contentType: 'image/jpeg' });
    expect(publishAttempt.status).toBe(403);
    expect(errorCode(publishAttempt)).toBe('SELLER_NOT_VERIFIED');

    const draftAttempt = await request(app)
      .post('/api/v1/marketplace')
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', TEST_ORIGIN)
      .field('title', 'Draft only')
      .field('species', 'goat')
      .field('price', '3000')
      .field('publish', 'false')
      .attach('images', FAKE_JPEG, { filename: 'goat.jpg', contentType: 'image/jpeg' });
    expect(draftAttempt.status).toBe(201);
    expect(draftAttempt.body?.data?.ad?.status).toBe('draft');
    const draftAdId = draftAttempt.body?.data?.ad?.id;
    expect(draftAdId).toBeTruthy();

    // Fixture update of verification status — tests the publish gate only,
    // not the operator verification endpoint.
    const acc = await Account.findOne({ email: `sell-${ts}@example.test` });
    expect(acc).toBeTruthy();
    const updated = await SellerProfile.findOneAndUpdate(
      { accountId: acc._id },
      { verificationStatus: 'verified', verifiedAt: new Date() },
      { new: true },
    );
    expect(updated.verificationStatus).toBe('verified');

    // Multipart publish flags arrive as strings on update, too.
    const publishDraft = await request(app)
      .patch(`/api/v1/marketplace/${draftAdId}`)
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', TEST_ORIGIN)
      .field('publish', 'true');
    expect(publishDraft.status).toBe(200);
    expect(publishDraft.body?.data?.ad?.status).toBe('published');

    const published = await request(app)
      .post('/api/v1/marketplace')
      .set('Cookie', s.cookie)
      .set('X-CSRF-Token', s.csrf)
      .set('Origin', TEST_ORIGIN)
      .field('title', 'Verified listing')
      .field('species', 'cow')
      .field('price', '9000')
      .field('publish', 'true')
      .attach('images', FAKE_JPEG, { filename: 'verified.jpg', contentType: 'image/jpeg' });
    expect(published.status).toBe(201);
    expect(published.body?.data?.ad?.status).toBe('published');
    expect(published.body?.data?.ad?.id).toBeTruthy();

    const mine = await request(app)
      .get('/api/v1/marketplace/me/listings')
      .set('Cookie', s.cookie)
      .set('Origin', TEST_ORIGIN);
    expect(mine.status).toBe(200);
    const ads = mine.body?.data?.ads;
    expect(Array.isArray(ads)).toBe(true);
    expect(ads.some((ad) => ad.status === 'published' && ad.title === 'Verified listing')).toBe(true);
  });
});


describe('Phase E: seller verification operator HTTP API', () => {
  test('non-operators are denied; operators can verify, reject, and receive validation errors', async () => {
    const ts = Date.now();
    const seller = await registerAndLogin('register/seller', {
      email: `verify-seller-${ts}@example.test`,
      password: 'TestPass1!',
      username: `verify_seller_${ts}`,
    });

    const profileRes = await request(app)
      .get('/api/v1/sellers/me')
      .set('Cookie', seller.cookie)
      .set('Origin', TEST_ORIGIN);

    expect(profileRes.status).toBe(200);
    const sellerProfileId = profileRes.body?.data?.profile?.id;
    expect(sellerProfileId).toBeTruthy();

    const forbidden = await request(app)
      .post(`/api/v1/sellers/${sellerProfileId}/verification`)
      .set('Cookie', seller.cookie)
      .set('X-CSRF-Token', seller.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'verified' });

    expect(forbidden.status).toBe(403);
    expect(errorCode(forbidden)).toBe('OPERATOR_REQUIRED');

    // The authenticated account is changed to an operator role in the test
    // database. This tests endpoint authorization without adding a public
    // registration path for privileged accounts.
    const operatorEmail = `operator-${ts}@example.test`;
    const operator = await registerAndLogin('register', {
      email: operatorEmail,
      password: 'TestPass1!',
      username: `operator_${ts}`,
    });

    const operatorAccount = await Account.findOneAndUpdate(
      { email: operatorEmail },
      { $set: { role: 'admin' } },
      { new: true },
    );
    expect(operatorAccount?.role).toBe('admin');

    const invalid = await request(app)
      .post(`/api/v1/sellers/${sellerProfileId}/verification`)
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'approved-by-magic' });

    expect(invalid.status).toBe(400);
    expect(errorCode(invalid)).toBe('INVALID_STATUS');

    const missing = await request(app)
      .post(`/api/v1/sellers/${new mongoose.Types.ObjectId()}/verification`)
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'verified' });

    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe('SELLER_PROFILE_NOT_FOUND');

    const verified = await request(app)
      .post(`/api/v1/sellers/${sellerProfileId}/verification`)
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'verified' });

    expect(verified.status).toBe(200);
    expect(verified.body?.data?.profile?.verificationStatus).toBe('verified');
    expect(verified.body?.data?.profile?.verifiedAt).toBeTruthy();

    const rejected = await request(app)
      .post(`/api/v1/sellers/${sellerProfileId}/verification`)
      .set('Cookie', operator.cookie)
      .set('X-CSRF-Token', operator.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'rejected' });

    expect(rejected.status).toBe(200);
    expect(rejected.body?.data?.profile?.verificationStatus).toBe('rejected');
    expect(rejected.body?.data?.profile?.verifiedAt).toBeNull();
  });
});

describe('Phase E: farm-access grant HTTP boundaries', () => {
  test('grant permissions are farm-scoped, exact, and revoked access stops working', async () => {
    const ts = Date.now();

    const ownerA = await registerAndLogin('register/farmer', {
      email: `grant-owner-a-${ts}@example.test`,
      password: 'TestPass1!',
      fullname: `Grant Owner A ${ts}`,
      phone: `2547${String(ts).slice(-8)}`,
    });

    const ownerB = await registerAndLogin('register/farmer', {
      email: `grant-owner-b-${ts}@example.test`,
      password: 'TestPass1!',
      fullname: `Grant Owner B ${ts}`,
      phone: `2548${String(ts).slice(-8)}`,
    });

    const delegateEmail = `grant-delegate-${ts}@example.test`;
    const delegate = await registerAndLogin('register', {
      email: delegateEmail,
      password: 'TestPass1!',
      username: `grant_delegate_${ts}`,
    });

    const farmARes = await request(app)
      .get('/api/v1/farmers/me')
      .set('Cookie', ownerA.cookie)
      .set('Origin', TEST_ORIGIN);
    const farmBRes = await request(app)
      .get('/api/v1/farmers/me')
      .set('Cookie', ownerB.cookie)
      .set('Origin', TEST_ORIGIN);

    expect(farmARes.status).toBe(200);
    expect(farmBRes.status).toBe(200);

    const farmAId = farmARes.body?.data?.profile?.id;
    const farmBId = farmBRes.body?.data?.profile?.id;
    expect(farmAId).toBeTruthy();
    expect(farmBId).toBeTruthy();
    expect(farmAId).not.toBe(farmBId);

    const delegateAccount = await Account.findOne({ email: delegateEmail });
    expect(delegateAccount?._id).toBeTruthy();

    const grantRes = await request(app)
      .post('/api/v1/farm-access/grants')
      .set('Cookie', ownerA.cookie)
      .set('X-CSRF-Token', ownerA.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        recipientAccountId: String(delegateAccount._id),
        permissions: ['animals.read'],
        note: 'Phase E HTTP acceptance',
      });

    expect(grantRes.status).toBe(201);
    const grant = grantRes.body?.data?.grant;
    const grantId = grant?._id || grant?.id;
    expect(grantId).toBeTruthy();
    expect(grant.permissions).toEqual(['animals.read']);

    const canReadGrantedFarm = await request(app)
      .get(`/api/v1/animals?farmerProfileId=${farmAId}`)
      .set('Cookie', delegate.cookie)
      .set('Origin', TEST_ORIGIN);

    expect(canReadGrantedFarm.status).toBe(200);

    const cannotReadOtherFarm = await request(app)
      .get(`/api/v1/animals?farmerProfileId=${farmBId}`)
      .set('Cookie', delegate.cookie)
      .set('Origin', TEST_ORIGIN);

    expect(cannotReadOtherFarm.status).toBe(403);

    // animals.read must not implicitly grant animals.create.
    const cannotWriteWithReadOnlyGrant = await request(app)
      .post('/api/v1/animals')
      .set('Cookie', delegate.cookie)
      .set('X-CSRF-Token', delegate.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        farmerProfileId: farmAId,
        name: 'Not Authorized',
        species: 'cow',
        gender: 'female',
      });

    expect(cannotWriteWithReadOnlyGrant.status).toBe(403);

    // Another farm owner cannot revoke a grant belonging to farm A.
    const otherOwnerRevoke = await request(app)
      .post(`/api/v1/farm-access/grants/${grantId}/revoke`)
      .set('Cookie', ownerB.cookie)
      .set('X-CSRF-Token', ownerB.csrf)
      .set('Origin', TEST_ORIGIN);

    expect(otherOwnerRevoke.status).toBe(404);
    expect(errorCode(otherOwnerRevoke)).toBe('GRANT_NOT_FOUND');

    const revoked = await request(app)
      .post(`/api/v1/farm-access/grants/${grantId}/revoke`)
      .set('Cookie', ownerA.cookie)
      .set('X-CSRF-Token', ownerA.csrf)
      .set('Origin', TEST_ORIGIN);

    expect(revoked.status).toBe(200);
    expect(revoked.body?.data?.grant?.status).toBe('revoked');

    const cannotReadAfterRevoke = await request(app)
      .get(`/api/v1/animals?farmerProfileId=${farmAId}`)
      .set('Cookie', delegate.cookie)
      .set('Origin', TEST_ORIGIN);

    expect(cannotReadAfterRevoke.status).toBe(403);

    const invalidPermission = await request(app)
      .post('/api/v1/farm-access/grants')
      .set('Cookie', ownerA.cookie)
      .set('X-CSRF-Token', ownerA.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({
        recipientAccountId: String(delegateAccount._id),
        permissions: ['*'],
      });

    expect(invalidPermission.status).toBe(400);
  });
});

describe('Phase E: public marketplace query and pagination', () => {
  test('search, species filters, pagination, and unpublished lifecycle states', async () => {
    await LivestockAd.init();

    const account = await Account.create({
      username: 'query_seller',
      email: 'query-seller@example.test',
      passwordHash: 'fixture-only',
      role: 'seller',
      isActive: true,
    });

    const now = Date.now();
    const fixtures = await LivestockAd.create([
      {
        title: 'Holstein Dairy Cow',
        description: 'Healthy dairy livestock',
        species: 'cow',
        location: 'Meru',
        price: 120000,
        currency: 'KES',
        status: 'published',
        publishedAt: new Date(now),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
      {
        title: 'Jersey Cow',
        description: 'Dairy livestock',
        species: 'cow',
        location: 'Nairobi',
        price: 90000,
        currency: 'KES',
        status: 'published',
        publishedAt: new Date(now - 1000),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
      {
        title: 'Boer Goat',
        description: 'Meat goat',
        species: 'goat',
        location: 'Meru',
        price: 30000,
        currency: 'KES',
        status: 'published',
        publishedAt: new Date(now - 2000),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
      {
        title: 'Closed Cow',
        species: 'cow',
        price: 50000,
        currency: 'KES',
        status: 'closed',
        publishedAt: new Date(now - 3000),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
      {
        title: 'Archived Cow',
        species: 'cow',
        price: 40000,
        currency: 'KES',
        status: 'archived',
        publishedAt: new Date(now - 4000),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
    ]);

    const firstPage = await request(app)
      .get('/api/v1/marketplace?species=cow&limit=1&page=1')
      .set('Origin', TEST_ORIGIN);

    expect(firstPage.status).toBe(200);
    expect(firstPage.body?.data?.total).toBe(2);
    expect(firstPage.body?.data?.limit).toBe(1);
    expect(firstPage.body?.data?.totalPages).toBe(2);
    expect(firstPage.body?.data?.items).toHaveLength(1);
    expect(firstPage.body.data.items[0].title).toBe('Holstein Dairy Cow');

    const secondPage = await request(app)
      .get('/api/v1/marketplace?species=cow&limit=1&page=2')
      .set('Origin', TEST_ORIGIN);

    expect(secondPage.status).toBe(200);
    expect(secondPage.body?.data?.items).toHaveLength(1);
    expect(secondPage.body.data.items[0].title).toBe('Jersey Cow');
    expect(secondPage.body.data.items[0].id).not.toBe(firstPage.body.data.items[0].id);

    const search = await request(app)
      .get('/api/v1/marketplace?q=Holstein')
      .set('Origin', TEST_ORIGIN);

    expect(search.status).toBe(200);
    expect(search.body?.data?.total).toBe(1);
    expect(search.body?.data?.items[0]?.title).toBe('Holstein Dairy Cow');

    for (const hidden of fixtures.slice(3)) {
      const detail = await request(app)
        .get(`/api/v1/marketplace/${hidden._id}`)
        .set('Origin', TEST_ORIGIN);
      expect(detail.status).toBe(404);
    }
  });
});

describe('Phase E: listing lifecycle HTTP transitions', () => {
  test('seller can close and archive listings; public detail hides both states', async () => {
    const ts = Date.now();
    const seller = await registerAndLogin('register/seller', {
      email: `lifecycle-${ts}@example.test`,
      password: 'TestPass1!',
      username: `lifecycle_${ts}`,
    });

    const account = await Account.findOne({ email: `lifecycle-${ts}@example.test` });
    expect(account?._id).toBeTruthy();

    const [toClose, toArchive] = await LivestockAd.create([
      {
        title: 'Cow to close',
        species: 'cow',
        price: 60000,
        currency: 'KES',
        status: 'published',
        publishedAt: new Date(),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
      {
        title: 'Goat to archive',
        species: 'goat',
        price: 15000,
        currency: 'KES',
        status: 'published',
        publishedAt: new Date(),
        advertiserAccountId: account._id,
        createdByAccountId: account._id,
      },
    ]);

    const closeRes = await request(app)
      .patch(`/api/v1/marketplace/${toClose._id}`)
      .set('Cookie', seller.cookie)
      .set('X-CSRF-Token', seller.csrf)
      .set('Origin', TEST_ORIGIN)
      .send({ status: 'closed' });

    expect(closeRes.status).toBe(200);
    expect((await LivestockAd.findById(toClose._id)).status).toBe('closed');

    const closedPublic = await request(app)
      .get(`/api/v1/marketplace/${toClose._id}`)
      .set('Origin', TEST_ORIGIN);
    expect(closedPublic.status).toBe(404);

    const archiveRes = await request(app)
      .post(`/api/v1/marketplace/${toArchive._id}/archive`)
      .set('Cookie', seller.cookie)
      .set('X-CSRF-Token', seller.csrf)
      .set('Origin', TEST_ORIGIN);

    expect(archiveRes.status).toBe(200);
    expect((await LivestockAd.findById(toArchive._id)).status).toBe('archived');

    const archivedPublic = await request(app)
      .get(`/api/v1/marketplace/${toArchive._id}`)
      .set('Origin', TEST_ORIGIN);
    expect(archivedPublic.status).toBe(404);
  });
});
