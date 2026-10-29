/* auth.mjs — password hashing and session tokens for the admin panel.
   scrypt for passwords (memory-hard, built into Node), HMAC-signed
   expiring tokens for sessions. No dependencies. */

import { scrypt, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

const SCRYPT_KEYLEN = 64;
/* One of OWASP's scrypt settings (N=2^14, r=8, p=5). It keeps each guess at
   16 MB, which matters on a small shared host where a burst of sign-ins must
   not run it out of memory, and gets the extra work from p instead. Records
   written before this carry no settings: they were hashed with Node's
   defaults (p=1) and still verify. */
const SCRYPT = { N: 16384, r: 8, p: 5 };
const SCRYPT_BEFORE = { N: 16384, r: 8, p: 1 };

const scryptAsync = (password, salt, params) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT_KEYLEN, params, (err, key) => (err ? reject(err) : resolve(key)))
  );

export async function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = (await scryptAsync(String(password), salt, SCRYPT)).toString("hex");
  return { salt, hash, scrypt: SCRYPT };
}

export async function verifyPassword(password, { salt, hash, scrypt: params = SCRYPT_BEFORE }) {
  if (!salt || !hash) return false;
  const candidate = await scryptAsync(String(password), salt, params);
  const stored = Buffer.from(hash, "hex");
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

/* A login record is only usable whole: a missing or short session secret
   would let a correct password through to a token that cannot be signed, or
   signed with something guessable. Says what is wrong, never the values. */
export function loginProblem(rec) {
  if (!rec || typeof rec !== "object") return "it is not a login record";
  if (!/^[0-9a-f]{32,}$/.test(rec.salt ?? "")) return "the salt is missing";
  if (!/^[0-9a-f]{128}$/.test(rec.hash ?? "")) return "the password hash is missing";
  if (typeof rec.sessionSecret !== "string" || rec.sessionSecret.length < 32) {
    return "the session secret is missing or too short";
  }
  const { N, r, p } = rec.scrypt ?? SCRYPT_BEFORE;
  if (![N, r, p].every(Number.isInteger) || N > 2 ** 16 || r > 16 || p > 16) {
    return "the hashing settings are not ones this server uses";
  }
  return null;
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
    // Forget finished windows once many addresses have called, so a flood
    // of them cannot grow this without end.
    if (hits.size > 10_000) {
      for (const [k, e] of hits) if (now - e.start > windowMs) hits.delete(k);
    }
    const entry = hits.get(key);
    if (!entry || now - entry.start > windowMs) {
      hits.set(key, { start: now, count: 1 });
      return true;
    }
    entry.count += 1;
    return entry.count <= max;
  };
}
