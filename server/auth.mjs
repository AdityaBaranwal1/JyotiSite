/* auth.mjs — password hashing and session tokens for the admin panel.
   scrypt for passwords (memory-hard, built into Node), HMAC-signed
   expiring tokens for sessions. No dependencies. */

import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const SCRYPT_KEYLEN = 64;

const scryptAsync = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT_KEYLEN, (err, key) => (err ? reject(err) : resolve(key)))
  );

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(String(password), salt)).toString("hex");
  return { salt, hash };
}

export async function verifyPassword(password, { salt, hash }) {
  if (!salt || !hash) return false;
  const candidate = await scryptAsync(String(password), salt);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/* ---------- Session tokens: "<expiryEpochMs>.<hmac>" ---------- */

const sign = (payload, secret) =>
  createHmac("sha256", secret).update(payload).digest("hex");

export function issueToken(secret, ttlMs = 7 * 24 * 60 * 60 * 1000, now = Date.now()) {
  const exp = String(now + ttlMs);
  return `${exp}.${sign(exp, secret)}`;
}

export function verifyToken(token, secret, now = Date.now()) {
  const [exp, mac] = String(token ?? "").split(".");
  if (!exp || !mac || !/^\d+$/.test(exp)) return false;
  if (Number(exp) < now) return false;
  const expected = sign(exp, secret);
  const a = Buffer.from(mac, "utf8"), b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}

/* ---------- Tiny fixed-window rate limiter (per key) ---------- */

export function makeRateLimiter({ windowMs = 15 * 60 * 1000, max = 10 } = {}) {
  const hits = new Map();
  return function allowed(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
