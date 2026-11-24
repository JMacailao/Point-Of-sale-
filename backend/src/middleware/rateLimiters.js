import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { env } from '../config/env.js';

const handler = (_req, res) => res.status(429).json({
  error: { code: 'RATE_LIMITED', message: 'Too many requests. Please slow down and try again shortly.' },
});

const make = (windowMs, limit, keyGenerator) => rateLimit({
  windowMs,
  limit: env.isTest ? 10_000 : limit,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler,
  ...(keyGenerator ? { keyGenerator } : {}),
});

export const apiLimiter = make(60_000, 600);
export const setupLimiter = make(15 * 60_000, 10);
export const authLimiter = make(60_000, 30);
export const salesLimiter = make(60_000, 120, (req) => req.firebaseUser?.uid || ipKeyGenerator(req.ip));
