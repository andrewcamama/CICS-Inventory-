import { Router } from 'express';
import QRCode from 'qrcode';
import { db, toSqlDateTime, withTransaction } from '../db.ts';
import { writeAuditLog } from '../auth.ts';
import { authenticate, getClientIp, requireRole } from '../middleware.ts';

const router = Router();

const VALID_CONDITIONS = ['Good', 'Fair', 'Needs Repair', 'Damaged', 'Condemned'] as const;
const VALID_STATUSES = ['Available', 'Borrowed', 'Under Maintenance', 'Missing', 'Disposed'] as const;

async function generateQrDataUrl(text: string): Promise<string> {
  return QRCode.toDataURL(text, {
    width: 320,
    margin: 2,
    color: { dark: '#0F172A', light: '#FFFFFF' },
    errorCorrectionLevel: 'M',
  });
}

async function suggestNextPropertyCode(): Promise<string> {
  const rows = await db.query<{ property_code: string }>(
    `SELECT property_code FROM properties WHERE property_code LIKE 'CICS-PRP-%' ORDER BY property_id DESC LIMIT 20`
  );
  let maxNum = 0;
  for (const r of rows) {
    const match = /^CICS-PRP-(\d+)$/i.exec(r.property_code.trim());
    if (match) {
      const n = Number(match[1]);
      if (n > maxNum) maxNum = n;
    }
  }
  const allCount = await db.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM properties');
  const next = Math.max(maxNum + 1, Number(allCount?.cnt || 0) + 1);
  return `CICS-PRP-${String(next).padStart(4, '0')}`;
}

router.get('/meta', authenticate, async (_req, res) => {
  try {
    const categories = await db.query('SELECT * FROM categories ORDER BY category_name ASC');
    const locations = await db.query('SELECT * FROM locations ORDER BY location_name ASC');
    const suggestedCode = await suggestNextPropertyCode();
    res.json({
      categories,
      locations,
      suggested_property_code: suggestedCode,
      conditions: VALID_CONDITIONS,
      statuses: VALID_STATUSES,
    });
  } catch (err) {
    console.error('Property meta error:', err);
    res.status(500).json({ error: 'Failed to load property metadata.' });
  }
});

router.get('/', authenticate, async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const locationId = req.query.location_id ? Number(req.query.location_id) : null;
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const condition = typeof req.query.condition === 'string' ? req.query.condition.trim() : '';
    const page = Math.max(1, Number(req.query.page || 1));
    const limit = Math.min(100, Math.max(1, Number(req.query.limit || 10)));
    const offset = (page - 1) * limit;

    const whereClauses: string[] = [];
    const params: any[] = [];

    if (search) {
      whereClauses.push(
        '(p.property_code LIKE ? OR p.property_name LIKE ? OR p.serial_number LIKE ? OR p.brand LIKE ? OR p.model LIKE ? OR p.assigned_personnel LIKE ?)'
      );
      const pattern = `%${search}%`;
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    if (categoryId && Number.isFinite(categoryId)) {
      whereClauses.push('p.category_id = ?');
      params.push(categoryId);
    }
    if (locationId && Number.isFinite(locationId)) {
      whereClauses.push('p.location_id = ?');
      params.push(locationId);
    }
    if (status) {
      whereClauses.push('p.property_status = ?');
      params.push(status);
    }
    if (condition) {
      whereClauses.push('p.property_condition = ?');
      params.push(condition);
    }

    const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

    const countRow = await db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM properties p ${whereSql}`,
      params
    );

    const rows = await db.query(
      `SELECT p.*, c.category_name, l.location_name, l.building, l.room_number, q.qr_value, q.barcode_value
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       ${whereSql}
       ORDER BY p.property_id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({
      items: rows,
      pagination: {
        total: Number(countRow?.total || 0),
        page,
        limit,
        total_pages: Math.max(1, Math.ceil(Number(countRow?.total || 0) / limit)),
      },
    });
  } catch (err) {
    console.error('List properties error:', err);
    res.status(500).json({ error: 'Failed to retrieve properties.' });
  }
});

router.get('/lookup', authenticate, async (req, res) => {
  try {
    const code = typeof req.query.code === 'string' ? req.query.code.trim() : '';
    const rawMethod = typeof req.query.method === 'string' ? req.query.method.trim() : 'Manual';
    const scanMethod: 'QR' | 'Barcode' | 'Manual' =
      rawMethod === 'QR' || rawMethod === 'Barcode' ? rawMethod : 'Manual';
    const moduleName = typeof req.query.module === 'string' && req.query.module.trim()
      ? req.query.module.trim()
      : 'Property Management';

    if (!code) {
      res.status(400).json({ error: 'Property code, QR value, or serial number is required.' });
      return;
    }

    const property = await db.queryOne<Record<string, any>>(
      `SELECT p.*, c.category_name, l.location_name, l.building, l.room_number,
              q.qr_id, q.qr_value, q.barcode_value, q.qr_image_data
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       WHERE q.qr_value = ? OR q.barcode_value = ? OR p.property_code = ? OR p.serial_number = ?
       LIMIT 1`,
      [code, code, code, code]
    );

    await db.execute(
      `INSERT INTO scan_logs (scanned_code, scan_method, module, property_id, scanned_by, is_successful, scanned_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        code.slice(0, 160),
        scanMethod,
        moduleName.slice(0, 80),
        property ? property.property_id : null,
        req.user?.user_id ?? null,
        property ? 1 : 0,
        toSqlDateTime(new Date()),
      ]
    );

    if (!property) {
      res.status(404).json({
        error: `No property found matching "${code}". Please verify the Property ID or Serial Number.`,
      });
      return;
    }

    if (!property.qr_image_data && property.qr_value) {
      property.qr_image_data = await generateQrDataUrl(property.qr_value);
    }

    const updateHistory = await db.query(
      `SELECT pu.*, u.full_name AS updated_by_name, u.username AS updated_by_username
       FROM property_updates pu
       LEFT JOIN users u ON u.user_id = pu.updated_by
       WHERE pu.property_id = ?
       ORDER BY pu.updated_at DESC, pu.update_id DESC`,
      [property.property_id]
    );

    const borrowHistory = await db.query(
      `SELECT bt.*, b.borrower_name, b.id_number, b.borrower_type, b.department,
              ru.full_name AS released_by_name, rec.full_name AS received_by_name
       FROM borrow_transactions bt
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       LEFT JOIN users ru ON ru.user_id = bt.released_by
       LEFT JOIN users rec ON rec.user_id = bt.received_by
       WHERE bt.property_id = ?
       ORDER BY bt.requested_at DESC, bt.transaction_id DESC`,
      [property.property_id]
    );

    res.json({
      property,
      update_history: updateHistory,
      borrow_history: borrowHistory,
    });
  } catch (err) {
    console.error('Property lookup error:', err);
    res.status(500).json({ error: 'Failed to look up property.' });
  }
});

router.get('/:id/qr', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid property ID.' });
      return;
    }

    const prop = await db.queryOne<Record<string, any>>(
      `SELECT p.property_id, p.property_code, p.property_name, p.serial_number,
              c.category_name, l.location_name, q.qr_value, q.barcode_value, q.qr_image_data
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       WHERE p.property_id = ?`,
      [id]
    );

    if (!prop) {
      res.status(404).json({ error: 'Property not found.' });
      return;
    }

    const qrValue = prop.qr_value || prop.property_code;
    let qrImageData = prop.qr_image_data;
    if (!qrImageData) {
      qrImageData = await generateQrDataUrl(qrValue);
      await db.execute(
        'UPDATE qr_codes SET qr_image_data = ? WHERE property_id = ?',
        [qrImageData, id]
      );
    }

    res.json({
      property_id: prop.property_id,
      property_code: prop.property_code,
      property_name: prop.property_name,
      serial_number: prop.serial_number,
      category_name: prop.category_name,
      location_name: prop.location_name,
      qr_value: qrValue,
      qr_image_data: qrImageData,
    });
  } catch (err) {
    console.error('QR fetch error:', err);
    res.status(500).json({ error: 'Failed to generate QR label.' });
  }
});

router.get('/:id', authenticate, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid property ID.' });
      return;
    }

    const property = await db.queryOne<Record<string, any>>(
      `SELECT p.*, c.category_name, l.location_name, l.building, l.room_number,
              q.qr_id, q.qr_value, q.barcode_value, q.qr_image_data
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       WHERE p.property_id = ?`,
      [id]
    );

    if (!property) {
      res.status(404).json({ error: 'Property not found.' });
      return;
    }

    if (!property.qr_image_data && property.qr_value) {
      property.qr_image_data = await generateQrDataUrl(property.qr_value);
    }

    const updateHistory = await db.query(
      `SELECT pu.*, u.full_name AS updated_by_name, u.username AS updated_by_username
       FROM property_updates pu
       LEFT JOIN users u ON u.user_id = pu.updated_by
       WHERE pu.property_id = ?
       ORDER BY pu.updated_at DESC, pu.update_id DESC`,
      [id]
    );

    const borrowHistory = await db.query(
      `SELECT bt.*, b.borrower_name, b.id_number, b.borrower_type, b.department,
              ru.full_name AS released_by_name, rec.full_name AS received_by_name
       FROM borrow_transactions bt
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       LEFT JOIN users ru ON ru.user_id = bt.released_by
       LEFT JOIN users rec ON rec.user_id = bt.received_by
       WHERE bt.property_id = ?
       ORDER BY bt.requested_at DESC, bt.transaction_id DESC`,
      [id]
    );

    res.json({ property, update_history: updateHistory, borrow_history: borrowHistory });
  } catch (err) {
    console.error('Get property error:', err);
    res.status(500).json({ error: 'Failed to retrieve property details.' });
  }
});

router.post('/', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const body = req.body || {};
    const propertyCode = typeof body.property_code === 'string' && body.property_code.trim()
      ? body.property_code.trim().toUpperCase()
      : await suggestNextPropertyCode();
    const propertyName = typeof body.property_name === 'string' ? body.property_name.trim() : '';
    const description = typeof body.description === 'string' ? body.description.trim() : null;
    const categoryId = Number(body.category_id);
    const locationId = Number(body.location_id);
    const brand = typeof body.brand === 'string' ? body.brand.trim() : null;
    const model = typeof body.model === 'string' ? body.model.trim() : null;
    const serialNumber = typeof body.serial_number === 'string' && body.serial_number.trim()
      ? body.serial_number.trim()
      : null;
    const acquisitionDate = typeof body.acquisition_date === 'string' && body.acquisition_date.trim()
      ? body.acquisition_date.trim()
      : null;
    const acquisitionCost = body.acquisition_cost !== undefined && body.acquisition_cost !== ''
      ? Number(body.acquisition_cost)
      : 0;
    const assignedPersonnel = typeof body.assigned_personnel === 'string' ? body.assigned_personnel.trim() : null;
    const condition = VALID_CONDITIONS.includes(body.property_condition) ? body.property_condition : 'Good';
    const status = VALID_STATUSES.includes(body.property_status) ? body.property_status : 'Available';

    if (!propertyName) {
      res.status(400).json({ error: 'Property name is required.' });
      return;
    }
    if (!Number.isFinite(categoryId) || categoryId <= 0) {
      res.status(400).json({ error: 'Valid category is required.' });
      return;
    }
    if (!Number.isFinite(locationId) || locationId <= 0) {
      res.status(400).json({ error: 'Valid location is required.' });
      return;
    }
    if (!Number.isFinite(acquisitionCost) || acquisitionCost < 0) {
      res.status(400).json({ error: 'Acquisition cost must be a valid non-negative amount.' });
      return;
    }

    const existing = await db.queryOne('SELECT property_id FROM properties WHERE property_code = ?', [propertyCode]);
    if (existing) {
      res.status(409).json({ error: `Property code "${propertyCode}" already exists.` });
      return;
    }

    const qrImageData = await generateQrDataUrl(propertyCode);
    const nowStr = toSqlDateTime(new Date());

    const createdId = await withTransaction(async (tx) => {
      const insertProp = await tx.execute(
        `INSERT INTO properties (
          property_code, property_name, description, category_id, brand, model,
          serial_number, acquisition_date, acquisition_cost, location_id,
          assigned_personnel, property_condition, property_status, created_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          propertyCode,
          propertyName,
          description,
          categoryId,
          brand,
          model,
          serialNumber,
          acquisitionDate,
          acquisitionCost,
          locationId,
          assignedPersonnel,
          condition,
          status,
          req.user!.user_id,
          nowStr,
          nowStr,
        ]
      );

      await tx.execute(
        `INSERT INTO qr_codes (property_id, qr_value, barcode_value, qr_image_data, generated_by, generated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [insertProp.insertId, propertyCode, serialNumber, qrImageData, req.user!.user_id, nowStr]
      );

      await writeAuditLog(
        {
          userId: req.user!.user_id,
          username: req.user!.username,
          action: 'CREATE_PROPERTY',
          entityType: 'properties',
          entityId: insertProp.insertId,
          details: `Created ${propertyCode} (${propertyName}) and generated QR code`,
          ipAddress: getClientIp(req),
        },
        tx
      );

      return insertProp.insertId;
    });

    const created = await db.queryOne(
      `SELECT p.*, c.category_name, l.location_name, q.qr_value, q.barcode_value, q.qr_image_data
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       WHERE p.property_id = ?`,
      [createdId]
    );

    res.status(201).json({ property: created });
  } catch (err) {
    console.error('Create property error:', err);
    res.status(500).json({ error: 'Failed to create property record.' });
  }
});

router.put('/:id', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isFinite(id)) {
      res.status(400).json({ error: 'Invalid property ID.' });
      return;
    }

    const existing = await db.queryOne<Record<string, any>>('SELECT * FROM properties WHERE property_id = ?', [id]);
    if (!existing) {
      res.status(404).json({ error: 'Property not found.' });
      return;
    }

    const body = req.body || {};
    const remarks = typeof body.remarks === 'string' && body.remarks.trim() ? body.remarks.trim() : null;

    const candidate: Record<string, any> = {
      property_name: body.property_name !== undefined ? String(body.property_name).trim() : existing.property_name,
      description: body.description !== undefined ? (body.description ? String(body.description).trim() : null) : existing.description,
      category_id: body.category_id !== undefined ? Number(body.category_id) : existing.category_id,
      brand: body.brand !== undefined ? (body.brand ? String(body.brand).trim() : null) : existing.brand,
      model: body.model !== undefined ? (body.model ? String(body.model).trim() : null) : existing.model,
      serial_number: body.serial_number !== undefined ? (body.serial_number ? String(body.serial_number).trim() : null) : existing.serial_number,
      acquisition_date: body.acquisition_date !== undefined ? (body.acquisition_date ? String(body.acquisition_date).trim() : null) : existing.acquisition_date,
      acquisition_cost: body.acquisition_cost !== undefined ? Number(body.acquisition_cost) : Number(existing.acquisition_cost),
      location_id: body.location_id !== undefined ? Number(body.location_id) : existing.location_id,
      assigned_personnel: body.assigned_personnel !== undefined ? (body.assigned_personnel ? String(body.assigned_personnel).trim() : null) : existing.assigned_personnel,
      property_condition: body.property_condition !== undefined ? body.property_condition : existing.property_condition,
      property_status: body.property_status !== undefined ? body.property_status : existing.property_status,
    };

    if (!candidate.property_name) {
      res.status(400).json({ error: 'Property name cannot be empty.' });
      return;
    }
    if (!VALID_CONDITIONS.includes(candidate.property_condition)) {
      res.status(400).json({ error: 'Invalid property condition.' });
      return;
    }
    if (!VALID_STATUSES.includes(candidate.property_status)) {
      res.status(400).json({ error: 'Invalid property status.' });
      return;
    }
    if (!Number.isFinite(candidate.acquisition_cost) || candidate.acquisition_cost < 0) {
      res.status(400).json({ error: 'Acquisition cost must be non-negative.' });
      return;
    }

    const trackedFields = Object.keys(candidate);
    const changes: Array<{ field: string; oldVal: string | null; newVal: string | null }> = [];
    for (const field of trackedFields) {
      const oldVal = existing[field] === null || existing[field] === undefined ? '' : String(existing[field]);
      const newVal = candidate[field] === null || candidate[field] === undefined ? '' : String(candidate[field]);
      if (field === 'acquisition_cost') {
        if (Number(oldVal || 0) !== Number(newVal || 0)) {
          changes.push({ field, oldVal: String(Number(oldVal || 0)), newVal: String(Number(newVal || 0)) });
        }
      } else if (oldVal !== newVal) {
        changes.push({ field, oldVal: oldVal || null, newVal: newVal || null });
      }
    }

    if (changes.length === 0) {
      res.json({ message: 'No changes detected.', changes_count: 0, property: existing });
      return;
    }

    const nowStr = toSqlDateTime(new Date());
    await withTransaction(async (tx) => {
      await tx.execute(
        `UPDATE properties
         SET property_name = ?, description = ?, category_id = ?, brand = ?, model = ?,
             serial_number = ?, acquisition_date = ?, acquisition_cost = ?, location_id = ?,
             assigned_personnel = ?, property_condition = ?, property_status = ?, updated_at = ?
         WHERE property_id = ?`,
        [
          candidate.property_name,
          candidate.description,
          candidate.category_id,
          candidate.brand,
          candidate.model,
          candidate.serial_number,
          candidate.acquisition_date,
          candidate.acquisition_cost,
          candidate.location_id,
          candidate.assigned_personnel,
          candidate.property_condition,
          candidate.property_status,
          nowStr,
          id,
        ]
      );

      if (candidate.serial_number !== existing.serial_number) {
        await tx.execute('UPDATE qr_codes SET barcode_value = ? WHERE property_id = ?', [
          candidate.serial_number,
          id,
        ]);
      }

      for (const ch of changes) {
        await tx.execute(
          `INSERT INTO property_updates (property_id, field_name, old_value, new_value, remarks, updated_by, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, ch.field, ch.oldVal, ch.newVal, remarks, req.user!.user_id, nowStr]
        );
      }

      await writeAuditLog(
        {
          userId: req.user!.user_id,
          username: req.user!.username,
          action: 'UPDATE_PROPERTY',
          entityType: 'properties',
          entityId: id,
          details: `Updated ${existing.property_code}: ${changes.map((c) => c.field).join(', ')}`,
          ipAddress: getClientIp(req),
        },
        tx
      );
    });

    const updated = await db.queryOne(
      `SELECT p.*, c.category_name, l.location_name, q.qr_value, q.barcode_value
       FROM properties p
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       LEFT JOIN qr_codes q ON q.property_id = p.property_id
       WHERE p.property_id = ?`,
      [id]
    );

    res.json({ property: updated, changes_count: changes.length });
  } catch (err) {
    console.error('Update property error:', err);
    res.status(500).json({ error: 'Failed to update property record.' });
  }
});

export default router;
