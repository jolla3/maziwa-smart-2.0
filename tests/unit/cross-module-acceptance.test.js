import { jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const srcRoot = path.join(root, 'src');

function read(rel) {
  return fs.readFileSync(path.join(srcRoot, rel), 'utf8');
}

function walkJs(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJs(p, out);
    else if (ent.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('cross-module acceptance', () => {
  test('all intended modules are mounted under expected API paths', () => {
    const app = read('app.js');
    const expected = [
      ["/api/userAuth", 'identity'],
      ["/api/v1/farmers", 'farmers'],
      ["/api/v1/animals", 'animals'],
      ["/api/v1/milk-yields", 'milk'],
      ["/api/v1/farm-access", 'farm-access'],
      ["/api/v1/finance", 'finance'],
      ["/api/v1/animal-health", 'animal-health'],
      ["/api/v1/breeding", 'breeding'],
      ["/api/v1/feed", 'feed'],
      ["/api/v1/farm-records", 'farm-records'],
      ["/api/v1/analytics", 'analytics'],
      ["/api/v1/marketplace", 'marketplace'],
      ["/api/v1/sellers", 'sellers'],
    ];
    for (const [mount] of expected) {
      expect(app).toContain(`app.use('${mount}'`);
    }
    expect(app).toMatch(/app\.get\('\/health'/);
    expect(app).toMatch(/app\.get\('\/ready'/);
  });

  test('domain modules do not import sibling private models', () => {
    const modulesDir = path.join(srcRoot, 'modules');
    const allowed = new Set([
      // No module may import another module's private Mongoose model.
    ]);
    const offenders = [];
    for (const file of walkJs(modulesDir)) {
      if (allowed.has(file)) continue;
      const text = fs.readFileSync(file, 'utf8');
      // Cross-module private model import pattern: from '../other/model.js'
      const re = /from\s+['"]\.\.\/(?!.*\/)([^/'"]+)\/model\.js['"]/g;
      let m;
      while ((m = re.exec(text))) {
        offenders.push(`${path.relative(srcRoot, file)} -> ${m[1]}/model.js`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('marketplace publish verification uses sellers public API, not SellerProfile model', () => {
    const mp = read('modules/livestock-marketplace/service.js');
    expect(mp).not.toMatch(/from ['"]\.\.\/sellers\/model\.js['"]/);
    expect(mp).toMatch(/sellersService\.assertVerifiedForPublish|assertVerifiedForPublish/);
    const sellers = read('modules/sellers/service.js');
    expect(sellers).toMatch(/export async function assertVerifiedForPublish/);
  });

  test('public ad DTO does not expose farm, creator, or verification internals', async () => {
    const { toPublicAdDto } = await import('../../src/modules/livestock-marketplace/publicDto.js');
    const dto = toPublicAdDto({
      _id: 'ad1',
      title: 'Cow',
      description: 'x',
      species: 'cattle',
      price: 100,
      currency: 'KES',
      location: 'Nairobi',
      images: [{ url: 'https://x', publicId: 'secret-public-id' }],
      status: 'published',
      attributes: {},
      advertiserAccountId: 'acc-secret',
      createdByAccountId: 'creator-secret',
      farmerProfileId: 'farm-secret',
      animalId: 'animal-secret',
      verificationEvidence: 'private',
    });
    expect(dto).not.toHaveProperty('advertiserAccountId');
    expect(dto).not.toHaveProperty('createdByAccountId');
    expect(dto).not.toHaveProperty('farmerProfileId');
    expect(dto).not.toHaveProperty('animalId');
    expect(dto).not.toHaveProperty('verificationEvidence');
    expect(JSON.stringify(dto)).not.toMatch(/secret|farm-secret|acc-secret/);
    // image publicId scrubbed
    expect(dto.images[0]).not.toHaveProperty('publicId');
  });

  test('milk and feed never import farm-finance; analytics never writes models', () => {
    const milk = read('modules/milk-production/service.js');
    const feed = read('modules/feed-management/service.js');
    const analytics = read('modules/analytics/service.js');
    expect(milk).not.toMatch(/farm-finance/);
    expect(feed).not.toMatch(/from ['"].*farm-finance/);
    expect(feed).toMatch(/createsFinanceEntry:\s*false/);
    expect(analytics).not.toMatch(/mongoose|\/model\.js/);
    expect(analytics).toMatch(/from ['"]\.\.\/farm-finance\/service\.js['"]/);
  });

  test('session cookies are httpOnly; CSRF middleware is mounted', () => {
    const app = read('app.js');
    expect(app).toMatch(/httpOnly:\s*true/);
    expect(app).toMatch(/MongoStore/);
    expect(app).toMatch(/csrfProtection/);
    expect(app).not.toMatch(/localStorage/);
  });

  test('requireAuth uses identity public session hydration, not Account model', () => {
    const mw = read('shared/middleware/requireAuth.js');
    expect(mw).not.toMatch(/from ['"].*identity\/model\.js['"]/);
    expect(mw).toMatch(/getAccountForSession/);
  });

  test('identity service does not import farmers or sellers models', () => {
    const id = read('modules/identity/service.js');
    expect(id).not.toMatch(/from ['"]\.\.\/farmers\/model\.js['"]/);
    expect(id).not.toMatch(/from ['"]\.\.\/sellers\/model\.js['"]/);
    expect(id).toMatch(/from ['"]\.\.\/farmers\/service\.js['"]/);
    expect(id).toMatch(/from ['"]\.\.\/sellers\/service\.js['"]/);
  });

  test('jest ignores .slice-backup directories', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const patterns = pkg.jest?.testPathIgnorePatterns || [];
    expect(patterns.some((p) => String(p).includes('slice-backup'))).toBe(true);
  });

  test('rate limit, job lock, and product single-flight remain distinct modules', () => {
    expect(fs.existsSync(path.join(srcRoot, 'shared/middleware/rateLimit.js'))).toBe(true);
    expect(fs.existsSync(path.join(srcRoot, 'shared/jobs/distributedLock.js'))).toBe(true);
    expect(fs.existsSync(path.join(srcRoot, 'shared/cache/productSingleFlight.js'))).toBe(true);
    const sf = read('shared/cache/productSingleFlight.js');
    const lock = read('shared/jobs/distributedLock.js');
    // product single-flight must not merely reuse job-skip lock semantics as its only mechanism
    expect(sf).toMatch(/generation|genKey|single.?flight|SET/i);
    expect(lock).toMatch(/lock|NX|PX/i);
  });
});
