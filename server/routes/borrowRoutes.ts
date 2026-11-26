import { Router } from 'express';
import { db, toSqlDate, toSqlDateTime, withTransaction } from '../db.ts';
import { writeAuditLog } from '../auth.ts';
import { authenticate, getClientIp, requireRole } from '../middleware.ts';

const router = Router();

const VALID_CONDITIONS = ['Good', 'Fair', 'Needs Repair', 'Damaged', 'Condemned'] as const;

router.get('/borrowers', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    const rows = search
      ? await db.query(
          `SELECT * FROM borrowers
           WHERE borrower_name LIKE ? OR id_number LIKE ? OR department LIKE ?
           ORDER BY borrower_name ASC LIMIT 50`,
          [`%${search}%`, `%${search}%`, `%${search}%`]
        )
      : await db.query('SELECT * FROM borrowers ORDER BY borrower_name ASC LIMIT 100');
    res.json({ borrowers: rows });
  } catch (err) {
    console.error('List borrowers error:', err);
    res.status(500).json({ error: 'Failed to retrieve borrowers.' });
  }
});

router.post('/borrowers', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const b = req.body || {};
    const name = typeof b.borrower_name === 'string' ? b.borrower_name.trim() : '';
    const idNumber = typeof b.id_number === 'string' ? b.id_number.trim() : '';
    const borrowerType = ['Faculty', 'Staff', 'Student', 'Guest'].includes(b.borrower_type)
      ? b.borrower_type
      : 'Faculty';
    const department = typeof b.department === 'string' && b.department.trim() ? b.department.trim() : 'CICS';
    const contactNumber = typeof b.contact_number === 'string' ? b.contact_number.trim() : null;
    const email = typeof b.email === 'string' ? b.email.trim() : null;

    if (!name || !idNumber) {
      res.status(400).json({ error: 'Borrower name and ID number are required.' });
      return;
    }

    const resMeta = await db.execute(
      `INSERT INTO borrowers (borrower_name, id_number, borrower_type, department, contact_number, email, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, idNumber, borrowerType, department, contactNumber, email, toSqlDateTime(new Date())]
    );
    const created = await db.queryOne('SELECT * FROM borrowers WHERE borrower_id = ?', [resMeta.insertId]);
    res.status(201).json({ borrower: created });
  } catch (err) {
    console.error('Create borrower error:', err);
    res.status(500).json({ error: 'Failed to create borrower.' });
  }
});

router.get('/transactions', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const status = typeof req.query.status === 'string' ? req.query.status.trim() : '';
    const today = toSqlDate(new Date());
    const whereSql = status ? 'WHERE bt.transaction_status = ?' : '';
    const params = status ? [status] : [];

    const rows = await db.query<Record<string, any>>(
      `SELECT bt.*,
              p.property_code, p.property_name, p.property_status, p.property_condition,
              c.category_name, l.location_name,
              b.borrower_name, b.id_number, b.borrower_type, b.department, b.contact_number,
              req_u.full_name AS requested_by_name,
              rev_u.full_name AS reviewed_by_name,
              rel_u.full_name AS released_by_name,
              rec_u.full_name AS received_by_name
       FROM borrow_transactions bt
       INNER JOIN properties p ON p.property_id = bt.property_id
       INNER JOIN categories c ON c.category_id = p.category_id
       INNER JOIN locations l ON l.location_id = p.location_id
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       LEFT JOIN users req_u ON req_u.user_id = bt.requested_by
       LEFT JOIN users rev_u ON rev_u.user_id = bt.reviewed_by
       LEFT JOIN users rel_u ON rel_u.user_id = bt.released_by
       LEFT JOIN users rec_u ON rec_u.user_id = bt.received_by
       ${whereSql}
       ORDER BY bt.transaction_id DESC
       LIMIT 150`,
      params
    );

    const enriched = rows.map((row) => {
      const isOverdue = row.transaction_status === 'Released' && row.expected_return_date < today;
      return {
        ...row,
        is_overdue: isOverdue ? 1 : 0,
      };
    });

    res.json({ transactions: enriched });
  } catch (err) {
    console.error('List borrow transactions error:', err);
    res.status(500).json({ error: 'Failed to load borrowing transactions.' });
  }
});

router.get('/active-by-property/:propertyId', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const propertyId = Number(req.params.propertyId);
    if (!Number.isFinite(propertyId)) {
      res.status(400).json({ error: 'Invalid property ID.' });
      return;
    }

    const tx = await db.queryOne<Record<string, any>>(
      `SELECT bt.*, b.borrower_name, b.id_number, b.borrower_type, b.department, b.contact_number,
              p.property_code, p.property_name, p.property_status, p.property_condition
       FROM borrow_transactions bt
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       INNER JOIN properties p ON p.property_id = bt.property_id
       WHERE bt.property_id = ? AND bt.transaction_status = 'Released'
       LIMIT 1`,
      [propertyId]
    );

    if (!tx) {
      res.status(404).json({ error: 'No active (Released) borrowing transaction found for this property.' });
      return;
    }

    const today = toSqlDate(new Date());
    tx.is_overdue = tx.expected_return_date < today ? 1 : 0;
    res.json({ transaction: tx });
  } catch (err) {
    console.error('Active borrow lookup error:', err);
    res.status(500).json({ error: 'Failed to look up active borrowing.' });
  }
});

router.post('/requests', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const body = req.body || {};
    const propertyId = Number(body.property_id);
    const purpose = typeof body.purpose === 'string' ? body.purpose.trim() : '';
    const expectedReturnDate = typeof body.expected_return_date === 'string' ? body.expected_return_date.trim() : '';

    if (!Number.isFinite(propertyId) || propertyId <= 0) {
      res.status(400).json({ error: 'Valid property selection is required.' });
      return;
    }
    if (!purpose) {
      res.status(400).json({ error: 'Borrowing purpose is required.' });
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedReturnDate)) {
      res.status(400).json({ error: 'Valid expected return date (YYYY-MM-DD) is required.' });
      return;
    }

    const property = await db.queryOne<Record<string, any>>(
      'SELECT property_id, property_code, property_name, property_status FROM properties WHERE property_id = ?',
      [propertyId]
    );
    if (!property) {
      res.status(404).json({ error: 'Property not found.' });
      return;
    }

    const activeTx = await db.queryOne(
      `SELECT transaction_id FROM borrow_transactions WHERE property_id = ? AND transaction_status = 'Released'`,
      [propertyId]
    );
    if (activeTx) {
      res.status(409).json({
        error: `Property ${property.property_code} already has an active Released borrowing transaction.`,
      });
      return;
    }

    const nowStr = toSqlDateTime(new Date());

    const createdTxId = await withTransaction(async (tx) => {
      let borrowerId = body.borrower_id ? Number(body.borrower_id) : 0;

      if (!borrowerId) {
        const nb = body.new_borrower || {};
        const borrowerName = typeof nb.borrower_name === 'string' ? nb.borrower_name.trim() : '';
        const idNumber = typeof nb.id_number === 'string' ? nb.id_number.trim() : '';
        const borrowerType = ['Faculty', 'Staff', 'Student', 'Guest'].includes(nb.borrower_type)
          ? nb.borrower_type
          : 'Faculty';
        const department = typeof nb.department === 'string' && nb.department.trim() ? nb.department.trim() : 'CICS';
        const contactNumber = typeof nb.contact_number === 'string' ? nb.contact_number.trim() : null;
        const email = typeof nb.email === 'string' ? nb.email.trim() : null;

        if (!borrowerName || !idNumber) {
          throw new Error('VALIDATION:Select an existing borrower or enter full name and ID number.');
        }

        const borrowerRes = await tx.execute(
          `INSERT INTO borrowers (borrower_name, id_number, borrower_type, department, contact_number, email, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [borrowerName, idNumber, borrowerType, department, contactNumber, email, nowStr]
        );
        borrowerId = borrowerRes.insertId;
      }

      const countRow = await tx.queryOne<{ cnt: number }>('SELECT COUNT(*) AS cnt FROM borrow_transactions');
      const seq = Number(countRow?.cnt || 0) + 1;
      const year = new Date().getFullYear();
      const txCode = `BRW-${year}-${String(seq).padStart(4, '0')}`;

      const insertRes = await tx.execute(
        `INSERT INTO borrow_transactions (
          transaction_code, property_id, borrower_id, purpose, expected_return_date,
          transaction_status, requested_by, requested_at
        ) VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)`,
        [txCode, propertyId, borrowerId, purpose, expectedReturnDate, req.user!.user_id, nowStr]
      );

      await writeAuditLog(
        {
          userId: req.user!.user_id,
          username: req.user!.username,
          action: 'BORROW_REQUEST',
          entityType: 'borrow_transactions',
          entityId: insertRes.insertId,
          details: `Created pending borrow request ${txCode} for ${property.property_code}`,
          ipAddress: getClientIp(req),
        },
        tx
      );

      return insertRes.insertId;
    });

    const created = await db.queryOne(
      `SELECT bt.*, p.property_code, p.property_name, p.property_status, p.property_condition,
              b.borrower_name, b.id_number, b.borrower_type, b.department
       FROM borrow_transactions bt
       INNER JOIN properties p ON p.property_id = bt.property_id
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       WHERE bt.transaction_id = ?`,
      [createdTxId]
    );

    res.status(201).json({ transaction: created });
  } catch (err: any) {
    if (typeof err?.message === 'string' && err.message.startsWith('VALIDATION:')) {
      res.status(400).json({ error: err.message.replace('VALIDATION:', '') });
      return;
    }
    console.error('Create borrow request error:', err);
    res.status(500).json({ error: 'Failed to create borrowing request.' });
  }
});

router.post('/requests/:id/review', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const txId = Number(req.params.id);
    if (!Number.isFinite(txId)) {
      res.status(400).json({ error: 'Invalid transaction ID.' });
      return;
    }

    const approved = Boolean(req.body?.approved);
    const rejectionReason = typeof req.body?.rejection_reason === 'string'
      ? req.body.rejection_reason.trim()
      : '';
    const nowStr = toSqlDateTime(new Date());

    if (!approved) {
      if (!rejectionReason) {
        res.status(400).json({ error: 'Rejection reason is required when rejecting a borrowing request.' });
        return;
      }

      await withTransaction(async (tx) => {
        const current = await tx.queryOne<Record<string, any>>(
          'SELECT * FROM borrow_transactions WHERE transaction_id = ?',
          [txId]
        );
        if (!current) {
          throw new Error('NOT_FOUND:Borrowing transaction not found.');
        }
        if (current.transaction_status !== 'Pending') {
          throw new Error(`CONFLICT:Transaction is already ${current.transaction_status}.`);
        }

        await tx.execute(
          `UPDATE borrow_transactions
           SET transaction_status = 'Rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?
           WHERE transaction_id = ?`,
          [rejectionReason, req.user!.user_id, nowStr, txId]
        );

        await writeAuditLog(
          {
            userId: req.user!.user_id,
            username: req.user!.username,
            action: 'BORROW_REJECT',
            entityType: 'borrow_transactions',
            entityId: txId,
            details: `Rejected ${current.transaction_code}: ${rejectionReason}`,
            ipAddress: getClientIp(req),
          },
          tx
        );
      });

      res.json({
        status: 'Rejected',
        message: 'Do Not Release Property. Request marked as Rejected.',
      });
      return;
    }

    // Approved: must also check property_status = 'Available' and no active Released transaction in ONE transaction
    const releasedTx = await withTransaction(async (tx) => {
      const current = await tx.queryOne<Record<string, any>>(
        'SELECT * FROM borrow_transactions WHERE transaction_id = ?',
        [txId]
      );
      if (!current) {
        throw new Error('NOT_FOUND:Borrowing transaction not found.');
      }
      if (current.transaction_status !== 'Pending') {
        throw new Error(`CONFLICT:Only Pending transactions can be approved (current: ${current.transaction_status}).`);
      }

      const prop = await tx.queryOne<Record<string, any>>(
        'SELECT property_id, property_code, property_name, property_status, property_condition FROM properties WHERE property_id = ?',
        [current.property_id]
      );
      if (!prop) {
        throw new Error('NOT_FOUND:Associated property not found.');
      }
      if (prop.property_status !== 'Available') {
        throw new Error(
          `CONFLICT:Do Not Release Property — ${prop.property_code} is currently "${prop.property_status}", not "Available". Reject this request instead.`
        );
      }

      const activeCheck = await tx.queryOne(
        `SELECT transaction_id FROM borrow_transactions WHERE property_id = ? AND transaction_status = 'Released'`,
        [prop.property_id]
      );
      if (activeCheck) {
        throw new Error(
          `CONFLICT:Do Not Release Property — ${prop.property_code} already has an active Released transaction.`
        );
      }

      await tx.execute(
        `UPDATE borrow_transactions
         SET transaction_status = 'Released',
             reviewed_by = ?, reviewed_at = ?,
             released_by = ?, released_at = ?,
             condition_on_release = ?
         WHERE transaction_id = ?`,
        [
          req.user!.user_id,
          nowStr,
          req.user!.user_id,
          nowStr,
          prop.property_condition,
          txId,
        ]
      );

      await tx.execute(
        `UPDATE properties SET property_status = 'Borrowed', updated_at = ? WHERE property_id = ?`,
        [nowStr, prop.property_id]
      );

      await tx.execute(
        `INSERT INTO property_updates (property_id, field_name, old_value, new_value, remarks, updated_by, updated_at)
         VALUES (?, 'property_status', 'Available', 'Borrowed', ?, ?, ?)`,
        [prop.property_id, `Released under ${current.transaction_code}`, req.user!.user_id, nowStr]
      );

      await writeAuditLog(
        {
          userId: req.user!.user_id,
          username: req.user!.username,
          action: 'BORROW_RELEASE',
          entityType: 'borrow_transactions',
          entityId: txId,
          details: `Approved and released ${prop.property_code} (${current.transaction_code})`,
          ipAddress: getClientIp(req),
        },
        tx
      );

      return txId;
    });

    const updated = await db.queryOne(
      `SELECT bt.*, p.property_code, p.property_name, p.property_status, b.borrower_name
       FROM borrow_transactions bt
       INNER JOIN properties p ON p.property_id = bt.property_id
       INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
       WHERE bt.transaction_id = ?`,
      [releasedTx]
    );

    res.json({
      status: 'Released',
      message: 'Borrowing request approved and property released.',
      transaction: updated,
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.startsWith('NOT_FOUND:')) {
      res.status(404).json({ error: msg.replace('NOT_FOUND:', '') });
      return;
    }
    if (msg.startsWith('CONFLICT:')) {
      res.status(409).json({ error: msg.replace('CONFLICT:', '') });
      return;
    }
    console.error('Review borrow request error:', err);
    res.status(500).json({ error: 'Failed to process borrowing review.' });
  }
});

router.post('/transactions/:id/return', authenticate, requireRole('admin', 'property_custodian'), async (req, res) => {
  try {
    const txId = Number(req.params.id);
    if (!Number.isFinite(txId)) {
      res.status(400).json({ error: 'Invalid transaction ID.' });
      return;
    }

    const body = req.body || {};
    const conditionOnReturn = VALID_CONDITIONS.includes(body.condition_on_return)
      ? body.condition_on_return
      : null;
    const isComplete = body.is_complete_on_return !== undefined ? Boolean(body.is_complete_on_return) : true;
    const returnRemarks = typeof body.return_remarks === 'string' && body.return_remarks.trim()
      ? body.return_remarks.trim()
      : null;

    if (!conditionOnReturn) {
      res.status(400).json({ error: 'Valid condition on return is required.' });
      return;
    }

    const nowStr = toSqlDateTime(new Date());

    const result = await withTransaction(async (tx) => {
      const current = await tx.queryOne<Record<string, any>>(
        'SELECT * FROM borrow_transactions WHERE transaction_id = ?',
        [txId]
      );
      if (!current) {
        throw new Error('NOT_FOUND:Borrowing transaction not found.');
      }
      if (current.transaction_status !== 'Released') {
        throw new Error(`CONFLICT:Only Released transactions can be returned (current: ${current.transaction_status}).`);
      }

      const prop = await tx.queryOne<Record<string, any>>(
        'SELECT property_id, property_code, property_name, property_status, property_condition FROM properties WHERE property_id = ?',
        [current.property_id]
      );
      if (!prop) {
        throw new Error('NOT_FOUND:Property not found.');
      }

      const needsMaintenance =
        !isComplete ||
        conditionOnReturn === 'Needs Repair' ||
        conditionOnReturn === 'Damaged' ||
        conditionOnReturn === 'Condemned';

      const nextPropertyStatus = needsMaintenance ? 'Under Maintenance' : 'Available';

      await tx.execute(
        `UPDATE borrow_transactions
         SET transaction_status = 'Returned',
             received_by = ?,
             returned_at = ?,
             condition_on_return = ?,
             is_complete_on_return = ?,
             return_remarks = ?
         WHERE transaction_id = ?`,
        [
          req.user!.user_id,
          nowStr,
          conditionOnReturn,
          isComplete ? 1 : 0,
          returnRemarks,
          txId,
        ]
      );

      await tx.execute(
        `UPDATE properties
         SET property_status = ?, property_condition = ?, updated_at = ?
         WHERE property_id = ?`,
        [nextPropertyStatus, conditionOnReturn, nowStr, prop.property_id]
      );

      if (prop.property_status !== nextPropertyStatus) {
        await tx.execute(
          `INSERT INTO property_updates (property_id, field_name, old_value, new_value, remarks, updated_by, updated_at)
           VALUES (?, 'property_status', ?, ?, ?, ?, ?)`,
          [
            prop.property_id,
            prop.property_status,
            nextPropertyStatus,
            `Returned (${current.transaction_code})${!isComplete ? ' - Incomplete accessories' : ''}${returnRemarks ? ': ' + returnRemarks : ''}`,
            req.user!.user_id,
            nowStr,
          ]
        );
      }

      if (prop.property_condition !== conditionOnReturn) {
        await tx.execute(
          `INSERT INTO property_updates (property_id, field_name, old_value, new_value, remarks, updated_by, updated_at)
           VALUES (?, 'property_condition', ?, ?, ?, ?, ?)`,
          [
            prop.property_id,
            prop.property_condition,
            conditionOnReturn,
            returnRemarks || `Condition assessed on return (${current.transaction_code})`,
            req.user!.user_id,
            nowStr,
          ]
        );
      }

      await writeAuditLog(
        {
          userId: req.user!.user_id,
          username: req.user!.username,
          action: 'RETURN_PROPERTY',
          entityType: 'borrow_transactions',
          entityId: txId,
          details: `Returned ${prop.property_code} (${current.transaction_code}) -> Status: ${nextPropertyStatus}, Condition: ${conditionOnReturn}, Complete: ${isComplete ? 'Yes' : 'No'}`,
          ipAddress: getClientIp(req),
        },
        tx
      );

      return {
        transaction_code: current.transaction_code,
        property_code: prop.property_code,
        next_property_status: nextPropertyStatus,
        condition_on_return: conditionOnReturn,
        is_complete: isComplete,
      };
    });

    res.json({
      message: `Property ${result.property_code} returned and marked as ${result.next_property_status}.`,
      result,
    });
  } catch (err: any) {
    const msg = String(err?.message || '');
    if (msg.startsWith('NOT_FOUND:')) {
      res.status(404).json({ error: msg.replace('NOT_FOUND:', '') });
      return;
    }
    if (msg.startsWith('CONFLICT:')) {
      res.status(409).json({ error: msg.replace('CONFLICT:', '') });
      return;
    }
    console.error('Return property error:', err);
    res.status(500).json({ error: 'Failed to process property return.' });
  }
});

export default router;
