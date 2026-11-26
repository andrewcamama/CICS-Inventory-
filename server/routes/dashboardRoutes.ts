import { Router } from 'express';
import { db } from '../db.ts';
import { authenticate } from '../middleware.ts';

const router = Router();

router.get('/', authenticate, async (_req, res) => {
  try {
    const totals = await db.queryOne<{
      total_properties: number;
      available: number;
      borrowed: number;
      under_maintenance: number;
      missing: number;
    }>(`
      SELECT
        COUNT(*) AS total_properties,
        COALESCE(SUM(CASE WHEN property_status = 'Available' THEN 1 ELSE 0 END), 0) AS available,
        COALESCE(SUM(CASE WHEN property_status = 'Borrowed' THEN 1 ELSE 0 END), 0) AS borrowed,
        COALESCE(SUM(CASE WHEN property_status = 'Under Maintenance' THEN 1 ELSE 0 END), 0) AS under_maintenance,
        COALESCE(SUM(CASE WHEN property_status = 'Missing' THEN 1 ELSE 0 END), 0) AS missing
      FROM properties
    `);

    const inventorySummary = await db.query<{
      category_id: number;
      category_name: string;
      total_count: number;
      available_count: number;
      borrowed_count: number;
      maintenance_count: number;
      missing_count: number;
      disposed_count: number;
      total_value: number;
    }>('SELECT * FROM v_inventory_summary');

    const activeBorrowings = await db.query<{
      transaction_id: number;
      transaction_code: string;
      property_id: number;
      property_code: string;
      property_name: string;
      category_name: string;
      location_name: string;
      borrower_id: number;
      borrower_name: string;
      id_number: string;
      borrower_type: string;
      department: string;
      purpose: string;
      expected_return_date: string;
      released_at: string;
      is_overdue: number;
      days_overdue: number;
    }>('SELECT * FROM v_active_borrowings');

    const overdueCount = activeBorrowings.filter((b) => Number(b.is_overdue) === 1).length;

    const recentAuditEvents = await db.query<{
      audit_id: number;
      username: string | null;
      action: string;
      entity_type: string | null;
      entity_id: number | null;
      details: string | null;
      created_at: string;
    }>(
      `SELECT audit_id, username, action, entity_type, entity_id, details, created_at
       FROM audit_logs
       ORDER BY created_at DESC, audit_id DESC
       LIMIT 5`
    );

    res.json({
      summary: {
        total_properties: Number(totals?.total_properties || 0),
        available: Number(totals?.available || 0),
        borrowed: Number(totals?.borrowed || 0),
        under_maintenance: Number(totals?.under_maintenance || 0),
        missing: Number(totals?.missing || 0),
        overdue_borrowings: overdueCount,
      },
      inventory_summary: inventorySummary.map((r) => ({
        ...r,
        total_count: Number(r.total_count || 0),
        available_count: Number(r.available_count || 0),
        borrowed_count: Number(r.borrowed_count || 0),
        maintenance_count: Number(r.maintenance_count || 0),
        missing_count: Number(r.missing_count || 0),
        disposed_count: Number(r.disposed_count || 0),
        total_value: Number(r.total_value || 0),
      })),
      active_borrowings: activeBorrowings,
      recent_audit_events: recentAuditEvents,
    });
  } catch (err) {
    console.error('Dashboard error:', err);
    res.status(500).json({ error: 'Failed to load dashboard data.' });
  }
});

export default router;
