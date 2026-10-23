import { v2 as cloudinary } from 'cloudinary';
import { env } from '../../config/environment.js';

export function isCloudinaryConfigured() {
  return Boolean(env.CLOUD_NAME && env.CLOUD_KEY && env.CLOUD_SECRET);
}

let configured = false;

export function getCloudinary() {
  if (!isCloudinaryConfigured()) {
    const err = new Error('Cloudinary is not configured (CLOUD_NAME, CLOUD_KEY, CLOUD_SECRET)');
    err.code = 'CLOUDINARY_NOT_CONFIGURED';
    throw err;
  }
  if (!configured) {
    cloudinary.config({
      cloud_name: env.CLOUD_NAME,
      api_key: env.CLOUD_KEY,
      api_secret: env.CLOUD_SECRET,
      secure: true,
    });
    configured = true;
  }
  return cloudinary;
}

/** Destroy a Cloudinary asset by public_id when present. */
export async function destroyCloudinaryAsset(publicId) {
  if (!publicId || !isCloudinaryConfigured()) return { result: 'skipped' };
  const c = getCloudinary();
  return c.uploader.destroy(publicId, { invalidate: true });
}
