import { randomUUID } from 'node:crypto';
import { storageConfigured, supabaseAdmin } from '../config/storage.js';
import { AppError, badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const BUCKETS = { storeAssets: 'store-assets', productImages: 'product-images' };

/** Identifies the image type from its magic bytes (the client-sent MIME type is not trusted). */
function sniffImage(buffer) {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { ext: 'png', type: 'image/png' };
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return { ext: 'jpg', type: 'image/jpeg' };
  }
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    return { ext: 'webp', type: 'image/webp' };
  }
  return null;
}

export async function uploadImage(bucket, folder, file) {
  if (!file) return null;
  if (!storageConfigured()) {
    throw new AppError(503, 'STORAGE_NOT_CONFIGURED', 'Image uploads are not configured on the server (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  }
  const kind = sniffImage(file.buffer);
  if (!kind) throw badRequest('The uploaded file is not a valid PNG, JPEG or WebP image');

  const path = `${folder}/${randomUUID()}.${kind.ext}`;
  const { error } = await supabaseAdmin().storage.from(bucket).upload(path, file.buffer, {
    contentType: kind.type,
    cacheControl: '31536000',
    upsert: false,
  });
  if (error) {
    logger.error({ err: error, bucket }, 'storage upload failed');
    throw new AppError(502, 'STORAGE_ERROR', 'Could not upload the image. Please try again.');
  }
  const { data } = supabaseAdmin().storage.from(bucket).getPublicUrl(path);
  return { url: data.publicUrl, path };
}

/** Best-effort removal of a previously uploaded object given its public URL. */
export async function removeImageByUrl(bucket, url) {
  if (!url || !storageConfigured()) return;
  const marker = `/storage/v1/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return;
  const path = decodeURIComponent(url.slice(idx + marker.length));
  const { error } = await supabaseAdmin().storage.from(bucket).remove([path]);
  if (error) logger.warn({ err: error, path }, 'failed to remove old image');
}
