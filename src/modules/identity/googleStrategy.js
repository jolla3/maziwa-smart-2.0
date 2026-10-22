import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { env, isProduction } from '../../config/environment.js';
import { findOrCreateGoogleAccount } from './service.js';
import { IdentityError, normalizeGoogleSignupRole } from './validation.js';

export const hasGoogleOAuthConfig = Boolean(
  env.GOOGLE_CLIENT_ID
  && env.GOOGLE_CLIENT_SECRET
  && (!isProduction || env.GOOGLE_CALLBACK_URL)
);

if (hasGoogleOAuthConfig) {
  passport.use('google', new GoogleStrategy({
    clientID: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    callbackURL: env.GOOGLE_CALLBACK_URL || `http://localhost:${env.PORT}/api/userAuth/google/callback`,
    passReqToCallback: true,
  }, async (req, _accessToken, _refreshToken, profile, done) => {
    try {
      const role = normalizeGoogleSignupRole(req.oauthSelectedRole);
      if (!role) return done(new IdentityError(400, 'INVALID_GOOGLE_ROLE', 'Unsupported Google sign-in role.'));
      const account = await findOrCreateGoogleAccount(profile, role);
      return done(null, account);
    } catch (error) {
      return done(error);
    }
  }));
}

export default passport;
