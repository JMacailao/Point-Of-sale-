import multer from 'multer';
import { badRequest } from '../utils/errors.js';

const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp']);

export const imageUpload = (field) => {
  const mw = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 40 },
    fileFilter: (_req, file, cb) => {
      if (!ALLOWED.has(file.mimetype)) return cb(badRequest('Image must be PNG, JPEG or WebP'));
      cb(null, true);
    },
  }).single(field);
  return (req, res, next) => mw(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(badRequest('Image must be 2 MB or smaller'));
    if (err instanceof multer.MulterError) return next(badRequest(err.message));
    next(err);
  });
};
