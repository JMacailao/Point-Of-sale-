import { z } from 'zod';

export const uuid = z.uuid({ message: 'Invalid id' });
export const optionalText = (max) => z.preprocess(
  (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v),
  z.string().max(max).nullable().optional());
export const requiredText = (max, label = 'This field') => z.string({ error: `${label} is required` })
  .trim().min(1, `${label} is required`).max(max, `${label} must be at most ${max} characters`);
export const email = z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter a valid email address' }).max(254));
export const optionalEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().trim().toLowerCase().pipe(z.email({ message: 'Enter a valid email address' })).nullable().optional());

// Multipart forms send strings; accept "true"/"false" and numbers as strings.
export const boolish = z.preprocess((v) => {
  if (v === 'true' || v === '1' || v === 'on') return true;
  if (v === 'false' || v === '0' || v === '' ) return false;
  return v;
}, z.boolean());

export const money = (label = 'Amount') => z.coerce.number({ error: `${label} must be a number` })
  .min(0, `${label} cannot be negative`).max(99_999_999, `${label} is too large`)
  .refine((n) => Math.abs(Math.round(n * 100) - n * 100) < 1e-6, `${label} can have at most 2 decimal places`);

export const intField = (label, min = 0, max = 1_000_000) => z.coerce.number({ error: `${label} must be a number` })
  .int(`${label} must be a whole number`).min(min, `${label} must be at least ${min}`).max(max, `${label} is too large`);

export const password = z.string()
  .min(8, 'Password must be at least 8 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[a-z]/, 'Password must contain a lowercase letter')
  .regex(/[A-Z]/, 'Password must contain an uppercase letter')
  .regex(/[0-9]/, 'Password must contain a number');

export const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the YYYY-MM-DD date format');
