import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { db, toSqlDateTime } from './db.ts';
import type { DbExecutor } from './db.ts';

export type UserRole = 'admin' | 'property_custodian' | 'staff';

export interface AuthUser {
  user_id: number;
  username: string;
  full_name: string;
  email: string | null;
  role: UserRole;
}

const JWT_SECRET: string =
  process.env.JWT_SECRET && process.env.JWT_SECRET.trim().length >= 16
    ? process.env.JWT_SECRET.trim()
    : crypto.randomBytes(32).toString('hex');

export function hashPassword(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt}$${derived.toString('hex')}`;
}

export function verifyPassword(password: string, storedHash: string): boolean {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;

  const N = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const saltHex = parts[4];
  const hashHex = parts[5];

  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p) || !saltHex || !hashHex) {
    return false;
  }

  try {
    const saltBuf = Buffer.from(saltHex, 'hex');
    const storedBuf = Buffer.from(hashHex, 'hex');
    const derivedBuf = crypto.scryptSync(password, saltBuf, 64, { N, r, p });
    if (derivedBuf.length !== storedBuf.length) return false;
    return crypto.timingSafeEqual(derivedBuf, storedBuf);
  } catch {
    return false;
  }
}

export function signAuthToken(user: AuthUser): string {
  return jwt.sign(
    {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

export function verifyAuthToken(token: string): AuthUser {
  const decoded = jwt.verify(token, JWT_SECRET) as jwt.JwtPayload & AuthUser;
  return {
    user_id: decoded.user_id,
    username: decoded.username,
    full_name: decoded.full_name,
    email: decoded.email ?? null,
    role: decoded.role,
  };
}

export async function writeAuditLog(
  params: {
    userId?: number | null;
    username?: string | null;
    action: string;
    entityType?: string | null;
    entityId?: number | null;
    details?: string | null;
    ipAddress?: string | null;
  },
  executor: DbExecutor = db
): Promise<void> {
  await executor.execute(
    `INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      params.userId ?? null,
      params.username ?? null,
      params.action,
      params.entityType ?? null,
      params.entityId ?? null,
      params.details ?? null,
      params.ipAddress ?? null,
      toSqlDateTime(new Date()),
    ]
  );
}
