import { createRequire } from 'node:module';
import { env } from '../../config/environment.js';
import { logger } from '../../config/logger.js';

const require = createRequire(import.meta.url);
const Brevo = require('@getbrevo/brevo');

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function primaryFrontendUrl() {
  return String(env.FRONTEND_URL || 'http://localhost:5173').split(',').map((part) => part.trim()).filter(Boolean)[0]
    || 'http://localhost:5173';
}

export function buildPasswordResetUrl(token) {
  const url = new URL('/reset-password', primaryFrontendUrl());
  url.searchParams.set('token', token);
  return url.toString();
}

export async function sendMail(to, subject, html) {
  if (!env.BREVO_API_KEY) {
    logger.error('BREVO_API_KEY is not configured; transactional email was not sent');
    return { success: false, error: 'email_provider_not_configured' };
  }

  try {
    const api = new Brevo.TransactionalEmailsApi();
    api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, env.BREVO_API_KEY);
    const result = await api.sendTransacEmail({
      sender: {
        name: env.BREVO_SENDER_NAME || 'MaziwaSmart (No Reply)',
        email: env.BREVO_SENDER_EMAIL || 'maziwasmart@gmail.com',
      },
      to: [{ email: to }],
      subject,
      htmlContent: html,
      headers: {
        'X-Auto-Response-Suppress': 'All',
        'Auto-Submitted': 'auto-generated',
      },
    });
    return { success: true, messageId: result?.body?.messageId ?? null };
  } catch (error) {
    logger.error({ error: error?.message || String(error) }, 'Transactional email failed');
    return { success: false, error: error?.message || 'email_send_failed' };
  }
}

export async function sendWelcomeEmail(email, name, role = 'buyer') {
  const greetingByRole = {
    farmer: 'Welcome to MaziwaSmart Farmer Community!',
    seller: 'Welcome to MaziwaSmart Seller Portal!',
    default: 'Welcome to MaziwaSmart!',
  };
  const dashboardByRole = {
    farmer: '/fmr.drb',
    seller: '/slr.drb',
    admin: '/admindashboard',
    superadmin: '/spr.dmn',
    buyer: '/byr.drb',
    manager: '/man.drb',
    broker: '/byr.drb',
  };
  const subject = greetingByRole[role] || greetingByRole.default;
  const dashboardUrl = new URL(dashboardByRole[role] || '/login', primaryFrontendUrl()).toString();
  const firstName = escapeHtml(String(name || 'there').trim().split(/\s+/)[0]);
  const safeRole = escapeHtml(role);
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;background:#f9f9f9;">
      <h1 style="color:#00bcd4;">Hello ${firstName},</h1>
      <p>Thank you for joining <strong>MaziwaSmart</strong>, Kenya's livestock platform.</p>
      <p>Your account has been created as a <strong>${safeRole}</strong>.</p>
      <div style="background:#fff;padding:20px;border-radius:10px;margin:20px 0;">
        <h3>Next steps</h3>
        <ul><li>Complete your profile</li><li>Verify your phone number where required</li><li>Manage your farm records or browse livestock listings</li></ul>
      </div>
      <p><a href="${escapeHtml(dashboardUrl)}" style="background:#00bcd4;color:#fff;padding:12px 30px;text-decoration:none;border-radius:8px;font-weight:bold;">Go to MaziwaSmart</a></p>
      <p style="margin-top:30px;color:#666;font-size:14px;">Need help? Contact support@maziwasmart.com</p>
      <p style="color:#999;font-size:12px;">MaziwaSmart</p>
    </div>`;
  return sendMail(email, subject, html);
}

export async function sendPasswordResetEmail({ email, displayName, token }) {
  const resetUrl = buildPasswordResetUrl(token);
  const safeName = escapeHtml(displayName || 'there');
  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:24px;">
      <h2>Reset your MaziwaSmart password</h2>
      <p>Hello ${safeName},</p>
      <p>Use the link below to choose a new password. This link expires in one hour.</p>
      <p><a href="${escapeHtml(resetUrl)}">Reset password</a></p>
      <p>If you did not request this, you can ignore this email.</p>
      <p>MaziwaSmart Team</p>
    </div>`;
  return sendMail(email, 'MaziwaSmart Password Reset', html);
}
