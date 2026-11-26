import { Router } from 'express';
import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';
import { db, toSqlDate, toSqlDateTime } from '../db.ts';
import { writeAuditLog } from '../auth.ts';
import { authenticate, getClientIp } from '../middleware.ts';

const router = Router();

interface ReportPayload {
  period_type: 'Monthly' | 'Quarterly' | 'Annual' | 'Custom';
  start_date: string;
  end_date: string;
  generated_at: string;
  totals_by_status: {
    total_properties: number;
    available: number;
    borrowed: number;
    under_maintenance: number;
    missing: number;
    disposed: number;
    overdue: number;
    total_value: number;
  };
  by_category: Array<{
    category_name: string;
    total_count: number;
    available_count: number;
    borrowed_count: number;
    maintenance_count: number;
    missing_count: number;
    total_value: number;
  }>;
  by_location: Array<{
    location_name: string;
    building: string;
    room_number: string | null;
    total_count: number;
    available_count: number;
    borrowed_count: number;
    maintenance_count: number;
    missing_count: number;
  }>;
  properties_added: Array<Record<string, any>>;
  borrow_transactions: Array<Record<string, any>>;
  overdue_items: Array<Record<string, any>>;
  condition_changes: Array<Record<string, any>>;
}

function resolveDateRange(query: Record<string, any>): {
  period_type: 'Monthly' | 'Quarterly' | 'Annual' | 'Custom';
  start_date: string;
  end_date: string;
} {
  const rawPeriod = typeof query.period_type === 'string' ? query.period_type : 'Monthly';
  const period_type: 'Monthly' | 'Quarterly' | 'Annual' | 'Custom' =
    ['Monthly', 'Quarterly', 'Annual', 'Custom'].includes(rawPeriod)
      ? (rawPeriod as any)
      : 'Monthly';

  const now = new Date();
  let start: Date;
  let end: Date = now;

  if (period_type === 'Monthly') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (period_type === 'Quarterly') {
    const qStartMonth = Math.floor(now.getMonth() / 3) * 3;
    start = new Date(now.getFullYear(), qStartMonth, 1);
    end = new Date(now.getFullYear(), qStartMonth + 3, 0);
  } else if (period_type === 'Annual') {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  } else {
    const s = typeof query.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.start_date)
      ? query.start_date
      : toSqlDate(new Date(now.getFullYear(), now.getMonth(), 1));
    const e = typeof query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.end_date)
      ? query.end_date
      : toSqlDate(now);
    return { period_type, start_date: s, end_date: e };
  }

  const startStr = typeof query.start_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.start_date)
    ? query.start_date
    : toSqlDate(start);
  const endStr = typeof query.end_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(query.end_date)
    ? query.end_date
    : toSqlDate(end);

  return { period_type, start_date: startStr, end_date: endStr };
}

async function buildReportData(
  period_type: 'Monthly' | 'Quarterly' | 'Annual' | 'Custom',
  start_date: string,
  end_date: string
): Promise<ReportPayload> {
  const startDt = `${start_date} 00:00:00`;
  const endDt = `${end_date} 23:59:59`;

  const statusTotals = await db.queryOne<Record<string, any>>(`
    SELECT
      COUNT(*) AS total_properties,
      COALESCE(SUM(CASE WHEN property_status = 'Available' THEN 1 ELSE 0 END), 0) AS available,
      COALESCE(SUM(CASE WHEN property_status = 'Borrowed' THEN 1 ELSE 0 END), 0) AS borrowed,
      COALESCE(SUM(CASE WHEN property_status = 'Under Maintenance' THEN 1 ELSE 0 END), 0) AS under_maintenance,
      COALESCE(SUM(CASE WHEN property_status = 'Missing' THEN 1 ELSE 0 END), 0) AS missing,
      COALESCE(SUM(CASE WHEN property_status = 'Disposed' THEN 1 ELSE 0 END), 0) AS disposed,
      COALESCE(SUM(acquisition_cost), 0) AS total_value
    FROM properties
  `);

  const byCategory = await db.query<any>('SELECT * FROM v_inventory_summary');

  const byLocation = await db.query<any>(`
    SELECT
      l.location_id,
      l.location_name,
      l.building,
      l.room_number,
      COUNT(p.property_id) AS total_count,
      COALESCE(SUM(CASE WHEN p.property_status = 'Available' THEN 1 ELSE 0 END), 0) AS available_count,
      COALESCE(SUM(CASE WHEN p.property_status = 'Borrowed' THEN 1 ELSE 0 END), 0) AS borrowed_count,
      COALESCE(SUM(CASE WHEN p.property_status = 'Under Maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_count,
      COALESCE(SUM(CASE WHEN p.property_status = 'Missing' THEN 1 ELSE 0 END), 0) AS missing_count
    FROM locations l
    LEFT JOIN properties p ON p.location_id = l.location_id
    GROUP BY l.location_id, l.location_name, l.building, l.room_number
    ORDER BY total_count DESC, l.location_name ASC
  `);

  const propertiesAdded = await db.query<Record<string, any>>(
    `SELECT p.property_code, p.property_name, c.category_name, l.location_name,
            p.acquisition_date, p.acquisition_cost, p.property_condition, p.property_status, p.created_at
     FROM properties p
     INNER JOIN categories c ON c.category_id = p.category_id
     INNER JOIN locations l ON l.location_id = p.location_id
     WHERE (p.created_at BETWEEN ? AND ?) OR (p.acquisition_date BETWEEN ? AND ?)
     ORDER BY p.created_at DESC`,
    [startDt, endDt, start_date, end_date]
  );

  const borrowTransactions = await db.query<Record<string, any>>(
    `SELECT bt.transaction_code, bt.transaction_status, bt.purpose, bt.expected_return_date,
            bt.requested_at, bt.released_at, bt.returned_at, bt.condition_on_release, bt.condition_on_return,
            p.property_code, p.property_name, b.borrower_name, b.id_number, b.department
     FROM borrow_transactions bt
     INNER JOIN properties p ON p.property_id = bt.property_id
     INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
     WHERE bt.requested_at BETWEEN ? AND ?
        OR (bt.released_at BETWEEN ? AND ?)
        OR (bt.returned_at BETWEEN ? AND ?)
     ORDER BY bt.requested_at DESC`,
    [startDt, endDt, startDt, endDt, startDt, endDt]
  );

  const overdueItems = await db.query<Record<string, any>>(
    'SELECT * FROM v_active_borrowings WHERE is_overdue = 1'
  );

  const conditionChanges = await db.query<Record<string, any>>(
    `SELECT pu.update_id, pu.field_name, pu.old_value, pu.new_value, pu.remarks, pu.updated_at,
            p.property_code, p.property_name, u.full_name AS updated_by_name
     FROM property_updates pu
     INNER JOIN properties p ON p.property_id = pu.property_id
     LEFT JOIN users u ON u.user_id = pu.updated_by
     WHERE pu.updated_at BETWEEN ? AND ?
     ORDER BY pu.updated_at DESC`,
    [startDt, endDt]
  );

  return {
    period_type,
    start_date,
    end_date,
    generated_at: toSqlDateTime(new Date()),
    totals_by_status: {
      total_properties: Number(statusTotals?.total_properties || 0),
      available: Number(statusTotals?.available || 0),
      borrowed: Number(statusTotals?.borrowed || 0),
      under_maintenance: Number(statusTotals?.under_maintenance || 0),
      missing: Number(statusTotals?.missing || 0),
      disposed: Number(statusTotals?.disposed || 0),
      overdue: overdueItems.length,
      total_value: Number(statusTotals?.total_value || 0),
    },
    by_category: byCategory.map((c) => ({
      ...c,
      total_count: Number(c.total_count || 0),
      available_count: Number(c.available_count || 0),
      borrowed_count: Number(c.borrowed_count || 0),
      maintenance_count: Number(c.maintenance_count || 0),
      missing_count: Number(c.missing_count || 0),
      total_value: Number(c.total_value || 0),
    })),
    by_location: byLocation.map((l) => ({
      ...l,
      total_count: Number(l.total_count || 0),
      available_count: Number(l.available_count || 0),
      borrowed_count: Number(l.borrowed_count || 0),
      maintenance_count: Number(l.maintenance_count || 0),
      missing_count: Number(l.missing_count || 0),
    })),
    properties_added: propertiesAdded,
    borrow_transactions: borrowTransactions,
    overdue_items: overdueItems,
    condition_changes: conditionChanges,
  };
}

async function saveReportSummary(
  report: ReportPayload,
  format: 'Screen' | 'PDF' | 'Excel',
  userId: number
): Promise<number> {
  const title = `CICS ${report.period_type} Inventory Report (${report.start_date} to ${report.end_date})`;
  const res = await db.execute(
    `INSERT INTO inventory_reports (
      report_title, period_type, start_date, end_date,
      total_properties, total_available, total_borrowed, total_maintenance, total_missing, total_overdue,
      export_format, generated_by, generated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      title,
      report.period_type,
      report.start_date,
      report.end_date,
      report.totals_by_status.total_properties,
      report.totals_by_status.available,
      report.totals_by_status.borrowed,
      report.totals_by_status.under_maintenance,
      report.totals_by_status.missing,
      report.totals_by_status.overdue,
      format,
      userId,
      toSqlDateTime(new Date()),
    ]
  );
  return res.insertId;
}

router.get('/generate', authenticate, async (req, res) => {
  try {
    const { period_type, start_date, end_date } = resolveDateRange(req.query);
    if (start_date > end_date) {
      res.status(400).json({ error: 'Start date must be on or before end date.' });
      return;
    }

    const report = await buildReportData(period_type, start_date, end_date);
    if (req.query.save !== 'false') {
      await saveReportSummary(report, 'Screen', req.user!.user_id);
    }

    res.json(report);
  } catch (err) {
    console.error('Report generation error:', err);
    res.status(500).json({ error: 'Failed to generate inventory report.' });
  }
});

router.get('/history', authenticate, async (_req, res) => {
  try {
    const rows = await db.query(
      `SELECT ir.*, u.full_name AS generated_by_name, u.username AS generated_by_username
       FROM inventory_reports ir
       LEFT JOIN users u ON u.user_id = ir.generated_by
       ORDER BY ir.generated_at DESC, ir.report_id DESC
       LIMIT 30`
    );
    res.json({ reports: rows });
  } catch (err) {
    console.error('Report history error:', err);
    res.status(500).json({ error: 'Failed to load report history.' });
  }
});

router.get('/export/excel', authenticate, async (req, res) => {
  try {
    const { period_type, start_date, end_date } = resolveDateRange(req.query);
    const report = await buildReportData(period_type, start_date, end_date);
    const reportId = await saveReportSummary(report, 'Excel', req.user!.user_id);

    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'EXPORT_REPORT',
      entityType: 'inventory_reports',
      entityId: reportId,
      details: `Exported Excel report (${period_type}: ${start_date} to ${end_date})`,
      ipAddress: getClientIp(req),
    });

    const wb = new ExcelJS.Workbook();
    wb.creator = 'CICS Inventory & Asset Tracking System';
    wb.created = new Date();

    const summarySheet = wb.addWorksheet('Executive Summary');
    summarySheet.addRow(['Mindanao State University - Main Campus']);
    summarySheet.addRow(['College of Information and Computing Sciences (CICS)']);
    summarySheet.addRow([`Inventory Report (${period_type}): ${start_date} to ${end_date}`]);
    summarySheet.addRow([`Generated By: ${req.user!.full_name} (${req.user!.username})`, `Generated At: ${report.generated_at}`]);
    summarySheet.addRow([]);
    summarySheet.addRow(['Metric', 'Count / Value']);
    summarySheet.addRow(['Total Properties', report.totals_by_status.total_properties]);
    summarySheet.addRow(['Available', report.totals_by_status.available]);
    summarySheet.addRow(['Borrowed', report.totals_by_status.borrowed]);
    summarySheet.addRow(['Under Maintenance', report.totals_by_status.under_maintenance]);
    summarySheet.addRow(['Missing', report.totals_by_status.missing]);
    summarySheet.addRow(['Disposed', report.totals_by_status.disposed]);
    summarySheet.addRow(['Overdue Borrowings', report.totals_by_status.overdue]);
    summarySheet.addRow(['Total Acquisition Value (PHP)', report.totals_by_status.total_value]);
    summarySheet.getColumn(1).width = 34;
    summarySheet.getColumn(2).width = 24;

    const catSheet = wb.addWorksheet('By Category & Location');
    catSheet.addRow(['Category Breakdown']);
    catSheet.addRow(['Category', 'Total', 'Available', 'Borrowed', 'Maintenance', 'Missing', 'Total Value (PHP)']);
    for (const c of report.by_category) {
      catSheet.addRow([c.category_name, c.total_count, c.available_count, c.borrowed_count, c.maintenance_count, c.missing_count, c.total_value]);
    }
    catSheet.addRow([]);
    catSheet.addRow(['Location Breakdown']);
    catSheet.addRow(['Location', 'Building', 'Room', 'Total', 'Available', 'Borrowed', 'Maintenance', 'Missing']);
    for (const l of report.by_location) {
      catSheet.addRow([l.location_name, l.building, l.room_number || '', l.total_count, l.available_count, l.borrowed_count, l.maintenance_count, l.missing_count]);
    }
    catSheet.columns.forEach((col) => { col.width = 20; });

    const addedSheet = wb.addWorksheet('Properties Added');
    addedSheet.addRow(['Code', 'Name', 'Category', 'Location', 'Acq. Date', 'Cost (PHP)', 'Condition', 'Status']);
    for (const p of report.properties_added) {
      addedSheet.addRow([p.property_code, p.property_name, p.category_name, p.location_name, p.acquisition_date || '', Number(p.acquisition_cost || 0), p.property_condition, p.property_status]);
    }
    addedSheet.columns.forEach((col) => { col.width = 20; });

    const txSheet = wb.addWorksheet('Borrow & Return');
    txSheet.addRow(['Tx Code', 'Property Code', 'Property Name', 'Borrower', 'Department', 'Status', 'Expected Return', 'Released At', 'Returned At', 'Return Condition']);
    for (const t of report.borrow_transactions) {
      txSheet.addRow([t.transaction_code, t.property_code, t.property_name, t.borrower_name, t.department, t.transaction_status, t.expected_return_date, t.released_at || '', t.returned_at || '', t.condition_on_return || '']);
    }
    txSheet.columns.forEach((col) => { col.width = 20; });

    const overdueSheet = wb.addWorksheet('Overdue Items');
    overdueSheet.addRow(['Tx Code', 'Property Code', 'Property Name', 'Borrower', 'ID Number', 'Contact', 'Expected Return', 'Days Overdue']);
    for (const o of report.overdue_items) {
      overdueSheet.addRow([o.transaction_code, o.property_code, o.property_name, o.borrower_name, o.id_number, o.contact_number || '', o.expected_return_date, o.days_overdue]);
    }
    overdueSheet.columns.forEach((col) => { col.width = 20; });

    const changesSheet = wb.addWorksheet('Condition & Status Changes');
    changesSheet.addRow(['Date', 'Property Code', 'Property Name', 'Field', 'Old Value', 'New Value', 'Updated By', 'Remarks']);
    for (const ch of report.condition_changes) {
      changesSheet.addRow([ch.updated_at, ch.property_code, ch.property_name, ch.field_name, ch.old_value || '', ch.new_value || '', ch.updated_by_name || '', ch.remarks || '']);
    }
    changesSheet.columns.forEach((col) => { col.width = 22; });

    const filename = `CICS_Inventory_Report_${start_date}_to_${end_date}.xlsx`;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Excel export error:', err);
    res.status(500).json({ error: 'Failed to export Excel report.' });
  }
});

router.get('/export/pdf', authenticate, async (req, res) => {
  try {
    const { period_type, start_date, end_date } = resolveDateRange(req.query);
    const report = await buildReportData(period_type, start_date, end_date);
    const reportId = await saveReportSummary(report, 'PDF', req.user!.user_id);

    await writeAuditLog({
      userId: req.user!.user_id,
      username: req.user!.username,
      action: 'EXPORT_REPORT',
      entityType: 'inventory_reports',
      entityId: reportId,
      details: `Exported PDF report (${period_type}: ${start_date} to ${end_date})`,
      ipAddress: getClientIp(req),
    });

    const filename = `CICS_Inventory_Report_${start_date}_to_${end_date}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    const doc = new PDFDocument({ margin: 40, size: 'A4' });
    doc.pipe(res);

    doc.fillColor('#0F172A').fontSize(15).font('Helvetica-Bold')
      .text('Mindanao State University - Main Campus');
    doc.fillColor('#1D4ED8').fontSize(12).font('Helvetica-Bold')
      .text('College of Information and Computing Sciences (CICS)');
    doc.fillColor('#334155').fontSize(10).font('Helvetica')
      .text(`Inventory & Asset Tracking Report (${period_type}: ${start_date} to ${end_date})`)
      .text(`Generated: ${report.generated_at} by ${req.user!.full_name}`);
    doc.moveDown(0.8);

    // Summary Box
    doc.fillColor('#0F172A').fontSize(11).font('Helvetica-Bold').text('1. Inventory Status Summary');
    doc.moveDown(0.3);
    const t = report.totals_by_status;
    doc.fontSize(9.5).font('Helvetica')
      .text(`Total Properties: ${t.total_properties}   |   Available: ${t.available}   |   Borrowed: ${t.borrowed}   |   Under Maintenance: ${t.under_maintenance}`)
      .text(`Missing: ${t.missing}   |   Disposed: ${t.disposed}   |   Overdue Borrowings: ${t.overdue}   |   Total Asset Value: PHP ${t.total_value.toLocaleString('en-PH', { minimumFractionDigits: 2 })}`);
    doc.moveDown(0.8);

    // Category Summary
    doc.fontSize(11).font('Helvetica-Bold').text('2. Breakdown by Category');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    for (const c of report.by_category) {
      doc.text(`• ${c.category_name}: Total ${c.total_count} (Avail ${c.available_count}, Borrowed ${c.borrowed_count}, Maint ${c.maintenance_count}, Missing ${c.missing_count})`);
    }
    doc.moveDown(0.8);

    // Location Summary
    doc.fontSize(11).font('Helvetica-Bold').text('3. Breakdown by Location');
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    for (const l of report.by_location) {
      doc.text(`• ${l.location_name} (${l.building}${l.room_number ? ' Rm ' + l.room_number : ''}): Total ${l.total_count} (Avail ${l.available_count}, Borrowed ${l.borrowed_count})`);
    }
    doc.moveDown(0.8);

    // Overdue Items
    doc.fontSize(11).font('Helvetica-Bold').text(`4. Overdue Borrowings (${report.overdue_items.length})`);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    if (report.overdue_items.length === 0) {
      doc.text('No overdue items.');
    } else {
      for (const o of report.overdue_items) {
        doc.fillColor('#B91C1C').text(
          `• [${o.transaction_code}] ${o.property_code} - ${o.property_name} | Borrower: ${o.borrower_name} (${o.id_number}) | Due: ${o.expected_return_date} (${o.days_overdue}d overdue)`
        );
      }
      doc.fillColor('#0F172A');
    }
    doc.moveDown(0.8);

    // Properties Added
    doc.fontSize(11).font('Helvetica-Bold').text(`5. Properties Added in Period (${report.properties_added.length})`);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    if (report.properties_added.length === 0) {
      doc.text('No new properties recorded in this period.');
    } else {
      for (const p of report.properties_added.slice(0, 25)) {
        doc.text(`• ${p.property_code} - ${p.property_name} (${p.category_name}, ${p.location_name}) [${p.property_status}]`);
      }
    }
    doc.moveDown(0.8);

    // Transactions
    doc.fontSize(11).font('Helvetica-Bold').text(`6. Borrowing & Return Transactions (${report.borrow_transactions.length})`);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    if (report.borrow_transactions.length === 0) {
      doc.text('No borrowing or return activity in this period.');
    } else {
      for (const bt of report.borrow_transactions.slice(0, 25)) {
        doc.text(`• ${bt.transaction_code} [${bt.transaction_status}] ${bt.property_code} (${bt.property_name}) — ${bt.borrower_name}, due ${bt.expected_return_date}`);
      }
    }
    doc.moveDown(0.8);

    // Condition Changes
    doc.fontSize(11).font('Helvetica-Bold').text(`7. Condition & Status Changes (${report.condition_changes.length})`);
    doc.moveDown(0.3);
    doc.fontSize(9).font('Helvetica');
    if (report.condition_changes.length === 0) {
      doc.text('No property field updates recorded in this period.');
    } else {
      for (const ch of report.condition_changes.slice(0, 25)) {
        doc.text(`• ${ch.updated_at} | ${ch.property_code}: ${ch.field_name} "${ch.old_value ?? ''}" -> "${ch.new_value ?? ''}" (${ch.updated_by_name || 'System'})`);
      }
    }

    doc.end();
  } catch (err) {
    console.error('PDF export error:', err);
    res.status(500).json({ error: 'Failed to export PDF report.' });
  }
});

export default router;
