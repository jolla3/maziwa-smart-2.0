import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { Account } from './model.js';
import { FarmerProfile } from '../farmers/model.js';
import { SellerProfile } from '../sellers/model.js';
import { sendPasswordResetEmail, sendWelcomeEmail } from './emailService.js';
import { logger } from '../../config/logger.js';
import {
  IdentityError,
  assertEmail,
  assertPassword,
  normalizeEmail,
  normalizeFarmerCode,
} from './validation.js';

const BCRYPT_ROUNDS = 10;

function publicAccount(account) {
  return {
    id: String(account._id),
    username: account.username || '',
    email: account.email,
    phone: account.phone || null,
    location: account.location || null,
    photo: account.photo || null,
    role: account.role,
    onboarding_complete: Boolean(account.onboardingComplete),
  };
}

function duplicateEmailError(error) {
  return error?.code === 11000 && (error?.keyPattern?.email || String(error?.message).includes('email'));
}

async function assertEmailUnused(email) {
  if (await Account.exists({ email })) {
    throw new IdentityError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
  }
}

async function generateFarmerCode() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const candidate = crypto.randomInt(10_000_000, 100_000_000);
    if (!(await FarmerProfile.exists({ farmerCode: candidate }))) return candidate;
  }
  throw new IdentityError(503, 'FARMER_CODE_UNAVAILABLE', 'Could not generate a farmer code. Please try again.');
}

async function createAccountAndProfile(accountInput, profileCreator) {
  const account = await Account.create(accountInput);
  try {
    if (profileCreator) await profileCreator(account);
    return account;
  } catch (error) {
    await Account.deleteOne({ _id: account._id }).catch(() => {});
    throw error;
  }
}

export async function registerBuyer(input) {
  const email = assertEmail(input.email);
  const password = assertPassword(input.password);
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username) throw new IdentityError(400, 'USERNAME_REQUIRED', 'Username is required.');
  await assertEmailUnused(email);

  try {
    const account = await Account.create({
      username,
      email,
      phone: input.phone ? String(input.phone).trim() : undefined,
      role: 'buyer',
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      onboardingComplete: true,
    });
    return publicAccount(account);
  } catch (error) {
    if (duplicateEmailError(error)) throw new IdentityError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    throw error;
  }
}

export async function registerSeller(input) {
  const email = assertEmail(input.email);
  const password = assertPassword(input.password);
  const username = typeof input.username === 'string' ? input.username.trim() : '';
  if (!username) throw new IdentityError(400, 'USERNAME_REQUIRED', 'Username is required.');
  await assertEmailUnused(email);

  try {
    const account = await createAccountAndProfile({
      username,
      email,
      phone: input.phone ? String(input.phone).trim() : undefined,
      role: 'seller',
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      onboardingComplete: true,
    }, (created) => SellerProfile.create({ accountId: created._id, verificationStatus: 'pending' }));
    void sendWelcomeEmail(account.email, account.username, 'seller').catch((error) => logger.warn({ error: error.message }, 'Welcome email failed'));
    return {
      ...publicAccount(account),
      is_approved_seller: false,
      verification_status: 'pending',
    };
  } catch (error) {
    if (duplicateEmailError(error)) throw new IdentityError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    throw error;
  }
}

export async function registerFarmer(input) {
  const email = assertEmail(input.email);
  const password = assertPassword(input.password);
  const fullName = typeof input.fullname === 'string' ? input.fullname.trim() : '';
  const phone = input.phone ? String(input.phone).trim() : '';
  if (!fullName || !phone) {
    throw new IdentityError(400, 'FARMER_DETAILS_REQUIRED', 'Full name and phone number are required.');
  }
  await assertEmailUnused(email);
  if (await FarmerProfile.exists({ phone })) {
    throw new IdentityError(409, 'FARMER_PHONE_EXISTS', 'Farmer already exists with this phone number.');
  }
  const farmerCode = await generateFarmerCode();

  try {
    const account = await createAccountAndProfile({
      username: fullName,
      email,
      phone,
      location: typeof input.location === 'string' ? input.location.trim() : undefined,
      photo: typeof input.photo === 'string' ? input.photo.trim() : undefined,
      role: 'farmer',
      passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS),
      onboardingComplete: true,
    }, (created) => FarmerProfile.create({
      accountId: created._id,
      fullName,
      farmerCode,
      phone,
      email,
      location: typeof input.location === 'string' ? input.location.trim() : undefined,
      photo: typeof input.photo === 'string' ? input.photo.trim() : undefined,
      isActive: true,
    }));
    void sendWelcomeEmail(account.email, fullName, 'farmer').catch((error) => logger.warn({ error: error.message }, 'Welcome email failed'));

    return {
      ...publicAccount(account),
      fullname: fullName,
      farmer_code: farmerCode,
      join_date: account.createdAt,
    };
  } catch (error) {
    if (duplicateEmailError(error)) throw new IdentityError(409, 'EMAIL_EXISTS', 'An account with this email already exists.');
    throw error;
  }
}

export async function authenticatePassword(emailValue, passwordValue) {
  const email = assertEmail(emailValue);
  if (typeof passwordValue !== 'string' || passwordValue.length === 0) {
    throw new IdentityError(400, 'CREDENTIALS_REQUIRED', 'Email and password are required.');
  }
  const account = await Account.findOne({ email }).select('+passwordHash');
  if (!account) throw new IdentityError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  if (!account.isActive) throw new IdentityError(401, 'ACCOUNT_INACTIVE', 'This account is inactive.');
  if (!account.passwordHash) throw new IdentityError(409, 'PASSWORD_SETUP_REQUIRED', 'Complete registration first.');
  if (!(await bcrypt.compare(passwordValue, account.passwordHash))) {
    throw new IdentityError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  return account;
}

export async function findOrCreateGoogleAccount(profile, selectedRole) {
  const googleId = String(profile?.id || '').trim();
  const email = normalizeEmail(profile?.emails?.[0]?.value);
  if (!googleId || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IdentityError(401, 'GOOGLE_EMAIL_REQUIRED', 'Google sign-in did not provide a usable email address.');
  }

  let account = await Account.findOne({ googleId }).select('+passwordHash');
  if (!account) account = await Account.findOne({ email }).select('+passwordHash');

  if (account) {
    if (!account.isActive) throw new IdentityError(403, 'ACCOUNT_INACTIVE', 'This account is inactive.');
    if (!account.googleId) account.googleId = googleId;
    if (!account.photo && profile.photos?.[0]?.value) account.photo = profile.photos[0].value;
    await account.save();
    return account;
  }

  const displayName = String(profile.displayName || email.split('@')[0]).trim();
  try {
    const created = await createAccountAndProfile({
      username: displayName,
      email,
      googleId,
      photo: profile.photos?.[0]?.value || undefined,
      role: selectedRole,
      onboardingComplete: false,
    }, async (newAccount) => {
      if (selectedRole === 'farmer') {
        await FarmerProfile.create({
          accountId: newAccount._id,
          fullName: displayName,
          email,
          photo: profile.photos?.[0]?.value || undefined,
          isActive: true,
        });
      } else if (selectedRole === 'seller') {
        await SellerProfile.create({ accountId: newAccount._id, verificationStatus: 'pending' });
      }
    });
    void sendWelcomeEmail(created.email, displayName, selectedRole).catch((error) => logger.warn({ error: error.message }, 'Welcome email failed'));
    return created;
  } catch (error) {
    if (duplicateEmailError(error) || error?.code === 11000) {
      const racedAccount = await Account.findOne({ $or: [{ email }, { googleId }] }).select('+passwordHash');
      if (racedAccount) return racedAccount;
    }
    throw error;
  }
}

export async function needsPasswordSetup(account) {
  if (!account?.passwordHash || !account.onboardingComplete) return true;
  if (account.role === 'farmer') {
    const farmer = await FarmerProfile.findOne({ accountId: account._id }).select('farmerCode');
    return !farmer?.farmerCode;
  }
  return false;
}

export async function completePasswordSetup(accountId, input) {
  const password = assertPassword(input.password);
  const account = await Account.findById(accountId).select('+passwordHash');
  if (!account || !account.isActive) throw new IdentityError(404, 'ACCOUNT_NOT_FOUND', 'Account not found.');

  let farmerProfile = null;
  if (account.role === 'farmer') {
    farmerProfile = await FarmerProfile.findOne({ accountId: account._id });
    if (!farmerProfile) throw new IdentityError(409, 'FARMER_PROFILE_MISSING', 'Farmer profile is not available for this account.');

    if (!farmerProfile.farmerCode) {
      const code = normalizeFarmerCode(input.farmer_code);
      if (!code) throw new IdentityError(400, 'FARMER_CODE_REQUIRED', 'Farmer code must be an 8-digit number.');
      if (await FarmerProfile.exists({ farmerCode: code, _id: { $ne: farmerProfile._id } })) {
        throw new IdentityError(409, 'FARMER_CODE_EXISTS', `Farmer code ${code} already exists. Choose another one.`);
      }
      farmerProfile.farmerCode = code;
    }
    if (input.phone) farmerProfile.phone = String(input.phone).trim();
    if (input.location) farmerProfile.location = String(input.location).trim();
    await farmerProfile.save();
  }

  account.passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  if (input.phone) account.phone = String(input.phone).trim();
  if (input.location && account.role !== 'farmer') account.location = String(input.location).trim();
  account.onboardingComplete = true;
  await account.save();

  return account;
}

export async function requestPasswordReset(emailValue) {
  const email = normalizeEmail(emailValue);
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new IdentityError(400, 'EMAIL_REQUIRED', 'A valid email address is required.');
  }

  const account = await Account.findOne({ email }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');
  if (!account || !account.passwordHash) return { sent: false };

  const rawToken = crypto.randomBytes(32).toString('hex');
  account.resetPasswordTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
  account.resetPasswordExpiresAt = new Date(Date.now() + 60 * 60 * 1000);
  await account.save();

  const result = await sendPasswordResetEmail({
    email: account.email,
    displayName: account.username,
    token: rawToken,
  });
  if (!result.success) {
    account.resetPasswordTokenHash = undefined;
    account.resetPasswordExpiresAt = undefined;
    await account.save();
    return { sent: false };
  }
  return { sent: true };
}

export async function resetPassword(tokenValue, newPasswordValue) {
  if (typeof tokenValue !== 'string' || tokenValue.length < 32) {
    throw new IdentityError(400, 'INVALID_RESET_TOKEN', 'Invalid or expired token.');
  }
  const newPassword = assertPassword(newPasswordValue, 8);
  const tokenHash = crypto.createHash('sha256').update(tokenValue).digest('hex');
  const account = await Account.findOne({
    resetPasswordTokenHash: tokenHash,
    resetPasswordExpiresAt: { $gt: new Date() },
  }).select('+passwordHash +resetPasswordTokenHash +resetPasswordExpiresAt');

  if (!account) throw new IdentityError(400, 'INVALID_RESET_TOKEN', 'Invalid or expired token.');
  if (account.passwordHash && await bcrypt.compare(newPassword, account.passwordHash)) {
    throw new IdentityError(400, 'PASSWORD_REUSE', 'New password must be different from the current password.');
  }

  account.passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  account.resetPasswordTokenHash = undefined;
  account.resetPasswordExpiresAt = undefined;
  account.sessionVersion = Number(account.sessionVersion || 0) + 1;
  account.onboardingComplete = true;
  await account.save();
  return true;
}

export async function getProfile(account) {
  const base = publicAccount(account);
  if (account.role === 'farmer') {
    const farmer = await FarmerProfile.findOne({ accountId: account._id });
    if (!farmer) throw new IdentityError(404, 'PROFILE_NOT_FOUND', 'Farmer profile not found.');
    return {
      ...base,
      fullname: farmer.fullName,
      farmer_code: farmer.farmerCode ?? null,
      phone: farmer.phone || base.phone,
      location: farmer.location || base.location,
      photo: farmer.photo || base.photo,
      is_active: farmer.isActive,
      join_date: farmer.createdAt,
    };
  }
  if (account.role === 'seller') {
    const seller = await SellerProfile.findOne({ accountId: account._id });
    return {
      ...base,
      is_approved_seller: seller?.verificationStatus === 'verified',
      verification_status: seller?.verificationStatus || 'pending',
    };
  }
  return base;
}

export async function updateProfile(account, input) {
  // Match the legacy role contract: only farmers and sellers can use this endpoint.
  const fieldsByRole = {
    farmer: ['fullname', 'phone', 'location', 'photo'],
    seller: ['username', 'phone', 'photo', 'location'],
  };
  const fields = fieldsByRole[account.role] || [];
  if (!fields.length) {
    throw new IdentityError(403, 'PROFILE_UPDATE_FORBIDDEN', 'No updatable fields for your role.');
  }
  const changes = {};
  for (const field of fields) {
    if (input[field] !== undefined) changes[field] = input[field];
  }
  if (!Object.keys(changes).length) {
    throw new IdentityError(400, 'NO_VALID_FIELDS', 'No valid fields to update.');
  }

  if (account.role === 'farmer') {
    const farmer = await FarmerProfile.findOne({ accountId: account._id });
    if (!farmer) throw new IdentityError(404, 'PROFILE_NOT_FOUND', 'Farmer profile not found.');
    if (changes.fullname !== undefined) {
      farmer.fullName = String(changes.fullname).trim();
      account.username = farmer.fullName;
    }
    for (const field of ['phone', 'location', 'photo']) {
      if (changes[field] !== undefined) farmer[field] = String(changes[field]).trim();
    }
    await farmer.save();
  } else {
    for (const field of Object.keys(changes)) {
      if (field === 'username' && !String(changes[field]).trim()) {
        throw new IdentityError(400, 'INVALID_USERNAME', 'Username cannot be empty.');
      }
      account[field] = changes[field] === null ? undefined : String(changes[field]).trim();
    }
  }
  if (changes.phone !== undefined) account.phone = String(changes.phone).trim();
  if (changes.location !== undefined) account.location = String(changes.location).trim();
  if (changes.photo !== undefined) account.photo = String(changes.photo).trim();
  await account.save();
  return getProfile(account);
}

export { publicAccount };
