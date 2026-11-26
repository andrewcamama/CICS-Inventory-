import { Router } from 'express';
import { db, toSqlDateTime } from '../db.ts';
import { signAuthToken, verifyPassword, writeAuditLog } from '../auth.ts';
import type { UserRole } from '../auth.ts';
import { authenticate, getClientIp, loginRateLimiter } from '../middleware.ts';

const router = Router();

interface UserRow {
  user_id: number;
  username: string;
  password_hash: string;
  full_name: string;
  email: string | null;
  role: UserRole;
  is_active: number;
  failed_logins: number;
  locked_until: string | null;
  last_login_at: string | null;
}

function parseSqlDateTime(val: string | null): number {
  if (!val) return 0;
  const normalized = val.includes('T') ? val : val.replace(' ', 'T');
  const t = Date.parse(normalized);
  return Number.isNaN(t) ? 0 : t;
}

router.post('/login', loginRateLimiter, async (req, res) => {
  try {
    const username = typeof req.body?.username === 'string' ? req.body.username.trim() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    const ipAddress = getClientIp(req);

    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const user = await db.queryOne<UserRow>(
      `SELECT user_id, username, password_hash, full_name, email, role, is_active, failed_logins, locked_until, last_login_at
       FROM users WHERE username = ?`,
      [username]
    );

    if (!user) {
      await writeAuditLog({
        userId: null,
        username,
        action: 'LOGIN_FAILED',
        entityType: 'users',
        details: 'Unknown username attempted sign in',
        ipAddress,
      });
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    if (Number(user.is_active) !== 1) {
      await writeAuditLog({
        userId: user.user_id,
        username: user.username,
        action: 'LOGIN_FAILED',
        entityType: 'users',
        entityId: user.user_id,
        details: 'Inactive account attempted sign in',
        ipAddress,
      });
      res.status(403).json({ error: 'Your account has been deactivated. Contact the CICS Administrator.' });
      return;
    }

    const lockedUntilMs = parseSqlDateTime(user.locked_until);
    if (lockedUntilMs > Date.now()) {
      const minutesLeft = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000));
      await writeAuditLog({
        userId: user.user_id,
        username: user.username,
        action: 'LOGIN_FAILED',
        entityType: 'users',
        entityId: user.user_id,
        details: `Account locked (${minutesLeft} min remaining)`,
        ipAddress,
      });
      res.status(423).json({
        error: `Account temporarily locked due to repeated failed logins. Try again in ${minutesLeft} minute(s).`,
      });
      return;
    }

    const valid = verifyPassword(password, user.password_hash);
    if (!valid) {
      const nextFailures = Number(user.failed_logins || 0) + 1;
      const shouldLock = nextFailures >= 5;
      const lockedUntilStr = shouldLock
        ? toSqlDateTime(new Date(Date.now() + 15 * 60 * 1000))
        : null;

      await db.execute(
        'UPDATE users SET failed_logins = ?, locked_until = ?, updated_at = ? WHERE user_id = ?',
        [nextFailures, lockedUntilStr, toSqlDateTime(new Date()), user.user_id]
      );

      await writeAuditLog({
        userId: user.user_id,
        username: user.username,
        action: 'LOGIN_FAILED',
        entityType: 'users',
        entityId: user.user_id,
        details: shouldLock
          ? 'Invalid password; account locked for 15 minutes after 5 failed attempts'
          : `Invalid password (attempt ${nextFailures} of 5)`,
        ipAddress,
      });

      res.status(shouldLock ? 423 : 401).json({
        error: shouldLock
          ? 'Invalid credentials. Account locked for 15 minutes after 5 failed attempts.'
          : `Invalid username or password. (${5 - nextFailures} attempt(s) remaining before lockout)`,
      });
      return;
    }

    const nowStr = toSqlDateTime(new Date());
    await db.execute(
      'UPDATE users SET failed_logins = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE user_id = ?',
      [nowStr, nowStr, user.user_id]
    );

    const authUser = {
      user_id: user.user_id,
      username: user.username,
      full_name: user.full_name,
      email: user.email,
      role: user.role,
    };
    const token = signAuthToken(authUser);

    await writeAuditLog({
      userId: user.user_id,
      username: user.username,
      action: 'LOGIN_OK',
      entityType: 'users',
      entityId: user.user_id,
      details: `Signed in as ${user.role}`,
      ipAddress,
    });

    const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
    res.cookie('cics_token', token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: isSecure ? 'none' : 'lax',
      maxAge: 8 * 60 * 60 * 1000,
      path: '/',
    });

    res.json({ token, user: authUser });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Unable to process login request.' });
  }
});

router.post('/logout', authenticate, async (req, res) => {
  try {
    await writeAuditLog({
      userId: req.user?.user_id,
      username: req.user?.username,
      action: 'LOGOUT',
      entityType: 'users',
      entityId: req.user?.user_id,
      details: 'User signed out',
      ipAddress: getClientIp(req),
    });
  } catch {
    // Non-fatal audit error on logout
  }
  res.clearCookie('cics_token', { path: '/' });
  res.json({ ok: true });
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.user });
});

export default router;
