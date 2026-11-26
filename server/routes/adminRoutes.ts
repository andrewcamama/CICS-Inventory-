import { Router } from 'express';
import { db, toSqlDateTime } from '../db.ts';
import { hashPassword, writeAuditLog } from '../auth.ts';
import type { UserRole } from '../auth.ts';
import { authenticate, getClientIp, requireRole } from '../middleware.ts';

const router = Router();

router.use(authenticate, requireRole('admin'));

router.get('/users', async (_req, res) => {
  try {
    const users = await db.query(
      `SELECT user_id, username, full_name, email, role, is_active, failed_logins, locked_until, last_login_at, created_at
       FROM users ORDER BY user_id ASC`
    );
    res.json({ users });
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ error: 'Failed to load users.' });
  }
});

router.post('/users', async (req, res) => {
  try {
    const b = req.body || {};
    const username = typeof b.username === 'string' ? b.username.trim() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    const fullName = typeof b.full_name === 'string' ? b.full_name.trim() : '';
    const email = typeof b.email === 'string' && b.email.trim() ? b.email.trim() : null;
    const role: UserRole = ['admin', 'property_custodian', 'staff'].includes(b.role) ? b.role : 'staff';

    if (!username || username.length < 3) {
      res.status(400).json({ error: 'Username must be at least 3 characters.' });
      return;
    }
    if (!password || password.length < 8) {
      res.status(400).json({ error: 'Password must be at least 8 characters.' });
      return;
    }
    if (!fullName) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }

    const existing = await db.queryOne('SELECT user_id FROM users WHERE username = ?', [username]);
    if (existing) {
      res.status(409).json({ error: `Username "${username}" already exists.` });
      return;
    }

    const hash = hashPassword(password);
    const nowStr = toSqlDateTime(new Date());
    const result = await db.execute(
      `INSERT INTO users (username, password_hash, full_name, email, role, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
      [username, hash, fullName, email, role, nowStr, nowStr]
    );

    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'USER_MANAGE',
      entityType: 'users',
      entityId: result.insertId,
      details: `Created user ${username} (${role})`,
      ipAddress: getClientIp(req),
    });

    const created = await db.queryOne(
      'SELECT user_id, username, full_name, email, role, is_active, created_at FROM users WHERE user_id = ?',
      [result.insertId]
    );
    res.status(201).json({ user: created });
  } catch (err) {
    console.error('Create user error:', err);
    res.status(500).json({ error: 'Failed to create user.' });
  }
});

router.patch('/users/:id/status', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }
    if (id === req.user!.user_id) {
      res.status(400).json({ error: 'You cannot deactivate your own active admin account.' });
      return;
    }

    const isActive = req.body?.is_active ? 1 : 0;
    const nowStr = toSqlDateTime(new Date());
    const result = await db.execute(
      'UPDATE users SET is_active = ?, updated_at = ? WHERE user_id = ?',
      [isActive, nowStr, id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'USER_MANAGE',
      entityType: 'users',
      entityId: id,
      details: `${isActive ? 'Activated' : 'Deactivated'} user ID ${id}`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true, is_active: isActive });
  } catch (err) {
    console.error('Toggle user status error:', err);
    res.status(500).json({ error: 'Failed to update user status.' });
  }
});

router.post('/users/:id/reset-password', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const newPassword = typeof req.body?.new_password === 'string' ? req.body.new_password : '';
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      res.status(400).json({ error: 'New password must be at least 8 characters.' });
      return;
    }

    const hash = hashPassword(newPassword);
    const nowStr = toSqlDateTime(new Date());
    const result = await db.execute(
      'UPDATE users SET password_hash = ?, failed_logins = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?',
      [hash, nowStr, id]
    );
    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }

    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'USER_MANAGE',
      entityType: 'users',
      entityId: id,
      details: `Reset password and cleared lockouts for user ID ${id}`,
      ipAddress: getClientIp(req),
    });

    res.json({ ok: true });
  } catch (err) {
    console.error('Reset password error:', err);
    res.status(500).json({ error: 'Failed to reset password.' });
  }
});

router.post('/users/:id/unlock', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid user ID.' });
      return;
    }
    await db.execute(
      'UPDATE users SET failed_logins = 0, locked_until = NULL, updated_at = ? WHERE user_id = ?',
      [toSqlDateTime(new Date()), id]
    );
    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'USER_MANAGE',
      entityType: 'users',
      entityId: id,
      details: `Unlocked user ID ${id}`,
      ipAddress: getClientIp(req),
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Unlock user error:', err);
    res.status(500).json({ error: 'Failed to unlock user.' });
  }
});

// Categories
router.get('/categories', async (_req, res) => {
  const rows = await db.query(
    `SELECT c.*, COUNT(p.property_id) AS property_count
     FROM categories c
     LEFT JOIN properties p ON p.category_id = c.category_id
     GROUP BY c.category_id
     ORDER BY c.category_name ASC`
  );
  res.json({ categories: rows });
});

router.post('/categories', async (req, res) => {
  try {
    const name = typeof req.body?.category_name === 'string' ? req.body.category_name.trim() : '';
    const desc = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
    if (!name) {
      res.status(400).json({ error: 'Category name is required.' });
      return;
    }
    const existing = await db.queryOne('SELECT category_id FROM categories WHERE category_name = ?', [name]);
    if (existing) {
      res.status(409).json({ error: `Category "${name}" already exists.` });
      return;
    }
    const r = await db.execute(
      'INSERT INTO categories (category_name, description, created_at) VALUES (?, ?, ?)',
      [name, desc, toSqlDateTime(new Date())]
    );
    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'CATEGORY_MANAGE',
      entityType: 'categories',
      entityId: r.insertId,
      details: `Created category ${name}`,
      ipAddress: getClientIp(req),
    });
    const created = await db.queryOne('SELECT * FROM categories WHERE category_id = ?', [r.insertId]);
    res.status(201).json({ category: created });
  } catch (err) {
    console.error('Create category error:', err);
    res.status(500).json({ error: 'Failed to create category.' });
  }
});

router.delete('/categories/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inUse = await db.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM properties WHERE category_id = ?', [id]);
    if (Number(inUse?.cnt || 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a category that still has assigned properties.' });
      return;
    }
    await db.execute('DELETE FROM categories WHERE category_id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete category error:', err);
    res.status(500).json({ error: 'Failed to delete category.' });
  }
});

// Locations
router.get('/locations', async (_req, res) => {
  const rows = await db.query(
    `SELECT l.*, COUNT(p.property_id) AS property_count
     FROM locations l
     LEFT JOIN properties p ON p.location_id = l.location_id
     GROUP BY l.location_id
     ORDER BY l.location_name ASC`
  );
  res.json({ locations: rows });
});

router.post('/locations', async (req, res) => {
  try {
    const name = typeof req.body?.location_name === 'string' ? req.body.location_name.trim() : '';
    const building = typeof req.body?.building === 'string' && req.body.building.trim()
      ? req.body.building.trim()
      : 'CICS Building';
    const room = typeof req.body?.room_number === 'string' ? req.body.room_number.trim() : null;
    const desc = typeof req.body?.description === 'string' ? req.body.description.trim() : null;
    if (!name) {
      res.status(400).json({ error: 'Location name is required.' });
      return;
    }
    const existing = await db.queryOne('SELECT location_id FROM locations WHERE location_name = ?', [name]);
    if (existing) {
      res.status(409).json({ error: `Location "${name}" already exists.` });
      return;
    }
    const r = await db.execute(
      'INSERT INTO locations (location_name, building, room_number, description, created_at) VALUES (?, ?, ?, ?, ?)',
      [name, building, room, desc, toSqlDateTime(new Date())]
    );
    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'LOCATION_MANAGE',
      entityType: 'locations',
      entityId: r.insertId,
      details: `Created location ${name}`,
      ipAddress: getClientIp(req),
    });
    const created = await db.queryOne('SELECT * FROM locations WHERE location_id = ?', [r.insertId]);
    res.status(201).json({ location: created });
  } catch (err) {
    console.error('Create location error:', err);
    res.status(500).json({ error: 'Failed to create location.' });
  }
});

router.delete('/locations/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const inUse = await db.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM properties WHERE location_id = ?', [id]);
    if (Number(inUse?.cnt || 0) > 0) {
      res.status(409).json({ error: 'Cannot delete a location that still has assigned properties.' });
      return;
    }
    await db.execute('DELETE FROM locations WHERE location_id = ?', [id]);
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete location error:', err);
    res.status(500).json({ error: 'Failed to delete location.' });
  }
});

router.get('/audit-logs', async (_req, res) => {
  try {
    const auditLogs = await db.query(
      'SELECT * FROM audit_logs ORDER BY created_at DESC, audit_id DESC LIMIT 100'
    );
    const scanLogs = await db.query(
      `SELECT sl.*, p.property_code, p.property_name, u.username
       FROM scan_logs sl
       LEFT JOIN properties p ON p.property_id = sl.property_id
       LEFT JOIN users u ON u.user_id = sl.scanned_by
       ORDER BY sl.scanned_at DESC, sl.scan_id DESC LIMIT 100`
    );
    res.json({ audit_logs: auditLogs, scan_logs: scanLogs });
  } catch (err) {
    console.error('Audit logs error:', err);
    res.status(500).json({ error: 'Failed to load audit and scan logs.' });
  }
});

export default router;
