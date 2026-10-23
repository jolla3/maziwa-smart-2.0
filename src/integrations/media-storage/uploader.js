import multer from 'multer';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  getCloudinary,
  isCloudinaryConfigured,
} from './cloudinary.js';
import { AppError } from '../../shared/errors/AppError.js';

const IMAGE_MIME = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
]);

class CloudinaryStreamingStorage {
  constructor(folderName) {
    this.folderName = folderName;
  }

  _handleFile(_req, file, cb) {
    let finished = false;
    let uploadStream;

    const finish = (error, info) => {
      if (finished) return;
      finished = true;
      cb(error, info);
    };

    const fail = (error) => {
      if (finished) return;
      if (uploadStream && !uploadStream.destroyed) {
        uploadStream.destroy();
      }
      finish(error);
    };

    try {
      const cloudinary = getCloudinary();
      const baseName = path.parse(file.originalname || 'image').name
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_-]/g, '')
        .slice(0, 80) || 'image';

      uploadStream = cloudinary.uploader.upload_stream({
        folder: `maziwasmart/${this.folderName}`,
        public_id: `${Date.now()}-${randomUUID()}-${baseName}`,
        resource_type: 'image',
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
        overwrite: false,
      }, (error, result) => {
        if (error) return finish(error);
        if (!result?.secure_url || !result?.public_id) {
          return finish(new Error('Cloudinary returned incomplete upload metadata.'));
        }

        return finish(null, {
          path: result.secure_url,
          secure_url: result.secure_url,
          filename: result.public_id,
          public_id: result.public_id,
          width: result.width,
          height: result.height,
          format: result.format,
          bytes: result.bytes,
          size: result.bytes,
          resource_type: result.resource_type,
        });
      });

      file.stream.once('error', fail);
      uploadStream.once('error', fail);
      file.stream.pipe(uploadStream);
    } catch (error) {
      finish(error);
    }
  }

  _removeFile(_req, file, cb) {
    const publicId = file.public_id || file.filename;
    if (!publicId) return cb(null);

    try {
      getCloudinary().uploader.destroy(publicId, { invalidate: true })
        .then(() => cb(null), cb);
    } catch (error) {
      cb(error);
    }
  }
}

export function makeUploader(folderName, options = {}) {
  const maxFiles = options.maxFiles ?? 10;
  const maxFileSize = options.maxFileSize ?? 10 * 1024 * 1024;
  const imageOnly = options.imageOnly !== false;

  if (!isCloudinaryConfigured()) {
    const unavailable = (_req, _res, next) => next(new AppError(
      503,
      'CLOUDINARY_NOT_CONFIGURED',
      'Image upload is not configured on this server.',
    ));

    return {
      single: () => unavailable,
      array: () => unavailable,
    };
  }

  return multer({
    storage: new CloudinaryStreamingStorage(folderName),
    limits: {
      fileSize: maxFileSize,
      files: maxFiles,
    },
    fileFilter(_req, file, cb) {
      if (imageOnly && !IMAGE_MIME.has(String(file.mimetype || '').toLowerCase())) {
        return cb(new AppError(
          400,
          'INVALID_IMAGE_TYPE',
          'Only JPEG, PNG, and WebP images are allowed for listings.',
        ));
      }
      return cb(null, true);
    },
  });
}

export function filesToImageMeta(files = []) {
  return (files || []).map((file) => ({
    url: file.path || file.secure_url || file.url,
    publicId: file.filename || file.public_id,
    width: file.width,
    height: file.height,
    format: file.format,
    bytes: file.size || file.bytes,
  })).filter((image) => image.url && image.publicId);
}
