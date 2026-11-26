import mysql from 'mysql2/promise';
import { DatabaseSync } from 'node:sqlite';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export interface QueryResultMeta {
  insertId: number;
  affectedRows: number;
}

export interface DbExecutor {
  query<T = Record<string, any>>(sql: string, params?: any[]): Promise<T[]>;
  queryOne<T = Record<string, any>>(sql: string, params?: any[]): Promise<T | null>;
  execute(sql: string, params?: any[]): Promise<QueryResultMeta>;
}

let mysqlPool: mysql.Pool | null = null;
let sqliteDb: DatabaseSync | null = null;
let activeMode: 'mysql' | 'sqlite' = 'sqlite';

export function toSqlDateTime(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export function toSqlDate(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function hashSeedPassword(password: string): string {
  const N = 16384;
  const r = 8;
  const p = 1;
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64, { N, r, p }).toString('hex');
  return `scrypt$${N}$${r}$${p}$${salt}$${hash}`;
}

function initSqliteFallback(): DatabaseSync {
  const dataDir = path.resolve(process.cwd(), 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = path.join(dataDir, 'cics_preview.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA journal_mode = WAL;');

  const tableExists = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'")
    .get();

  if (!tableExists) {
    db.exec(`
      CREATE TABLE users (
        user_id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        full_name TEXT NOT NULL,
        email TEXT,
        role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'property_custodian', 'staff')),
        is_active INTEGER NOT NULL DEFAULT 1,
        failed_logins INTEGER NOT NULL DEFAULT 0,
        locked_until TEXT,
        last_login_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE categories (
        category_id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_name TEXT NOT NULL UNIQUE,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE locations (
        location_id INTEGER PRIMARY KEY AUTOINCREMENT,
        location_name TEXT NOT NULL UNIQUE,
        building TEXT NOT NULL DEFAULT 'CICS Building',
        room_number TEXT,
        description TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE properties (
        property_id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_code TEXT NOT NULL UNIQUE,
        property_name TEXT NOT NULL,
        description TEXT,
        category_id INTEGER NOT NULL REFERENCES categories(category_id),
        brand TEXT,
        model TEXT,
        serial_number TEXT,
        acquisition_date TEXT,
        acquisition_cost REAL NOT NULL DEFAULT 0,
        location_id INTEGER NOT NULL REFERENCES locations(location_id),
        assigned_personnel TEXT,
        property_condition TEXT NOT NULL DEFAULT 'Good' CHECK (property_condition IN ('Good', 'Fair', 'Needs Repair', 'Damaged', 'Condemned')),
        property_status TEXT NOT NULL DEFAULT 'Available' CHECK (property_status IN ('Available', 'Borrowed', 'Under Maintenance', 'Missing', 'Disposed')),
        created_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE qr_codes (
        qr_id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL UNIQUE REFERENCES properties(property_id) ON DELETE CASCADE,
        qr_value TEXT NOT NULL UNIQUE,
        barcode_value TEXT,
        qr_image_data TEXT,
        generated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE property_updates (
        update_id INTEGER PRIMARY KEY AUTOINCREMENT,
        property_id INTEGER NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
        field_name TEXT NOT NULL,
        old_value TEXT,
        new_value TEXT,
        remarks TEXT,
        updated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE borrowers (
        borrower_id INTEGER PRIMARY KEY AUTOINCREMENT,
        borrower_name TEXT NOT NULL,
        id_number TEXT NOT NULL,
        borrower_type TEXT NOT NULL DEFAULT 'Faculty' CHECK (borrower_type IN ('Faculty', 'Staff', 'Student', 'Guest')),
        department TEXT NOT NULL DEFAULT 'CICS',
        contact_number TEXT,
        email TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE borrow_transactions (
        transaction_id INTEGER PRIMARY KEY AUTOINCREMENT,
        transaction_code TEXT NOT NULL UNIQUE,
        property_id INTEGER NOT NULL REFERENCES properties(property_id) ON DELETE CASCADE,
        borrower_id INTEGER NOT NULL REFERENCES borrowers(borrower_id),
        purpose TEXT NOT NULL,
        expected_return_date TEXT NOT NULL,
        transaction_status TEXT NOT NULL DEFAULT 'Pending' CHECK (transaction_status IN ('Pending', 'Rejected', 'Released', 'Returned')),
        rejection_reason TEXT,
        requested_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        requested_at TEXT NOT NULL DEFAULT (datetime('now')),
        reviewed_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        reviewed_at TEXT,
        released_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        released_at TEXT,
        condition_on_release TEXT,
        received_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        returned_at TEXT,
        condition_on_return TEXT,
        is_complete_on_return INTEGER,
        return_remarks TEXT
      );

      CREATE TABLE scan_logs (
        scan_id INTEGER PRIMARY KEY AUTOINCREMENT,
        scanned_code TEXT NOT NULL,
        scan_method TEXT NOT NULL DEFAULT 'QR' CHECK (scan_method IN ('QR', 'Barcode', 'Manual')),
        module TEXT NOT NULL,
        property_id INTEGER REFERENCES properties(property_id) ON DELETE SET NULL,
        scanned_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        is_successful INTEGER NOT NULL DEFAULT 0,
        scanned_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE audit_logs (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        username TEXT,
        action TEXT NOT NULL,
        entity_type TEXT,
        entity_id INTEGER,
        details TEXT,
        ip_address TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE inventory_reports (
        report_id INTEGER PRIMARY KEY AUTOINCREMENT,
        report_title TEXT NOT NULL,
        period_type TEXT NOT NULL CHECK (period_type IN ('Monthly', 'Quarterly', 'Annual', 'Custom')),
        start_date TEXT NOT NULL,
        end_date TEXT NOT NULL,
        total_properties INTEGER NOT NULL DEFAULT 0,
        total_available INTEGER NOT NULL DEFAULT 0,
        total_borrowed INTEGER NOT NULL DEFAULT 0,
        total_maintenance INTEGER NOT NULL DEFAULT 0,
        total_missing INTEGER NOT NULL DEFAULT 0,
        total_overdue INTEGER NOT NULL DEFAULT 0,
        export_format TEXT NOT NULL DEFAULT 'Screen' CHECK (export_format IN ('Screen', 'PDF', 'Excel')),
        generated_by INTEGER REFERENCES users(user_id) ON DELETE SET NULL,
        generated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE VIEW v_inventory_summary AS
      SELECT
        c.category_id,
        c.category_name,
        COUNT(p.property_id) AS total_count,
        COALESCE(SUM(CASE WHEN p.property_status = 'Available' THEN 1 ELSE 0 END), 0) AS available_count,
        COALESCE(SUM(CASE WHEN p.property_status = 'Borrowed' THEN 1 ELSE 0 END), 0) AS borrowed_count,
        COALESCE(SUM(CASE WHEN p.property_status = 'Under Maintenance' THEN 1 ELSE 0 END), 0) AS maintenance_count,
        COALESCE(SUM(CASE WHEN p.property_status = 'Missing' THEN 1 ELSE 0 END), 0) AS missing_count,
        COALESCE(SUM(CASE WHEN p.property_status = 'Disposed' THEN 1 ELSE 0 END), 0) AS disposed_count,
        COALESCE(SUM(p.acquisition_cost), 0) AS total_value
      FROM categories c
      LEFT JOIN properties p ON p.category_id = c.category_id
      GROUP BY c.category_id, c.category_name
      ORDER BY total_count DESC, c.category_name ASC;

      CREATE VIEW v_active_borrowings AS
      SELECT
        bt.transaction_id,
        bt.transaction_code,
        bt.property_id,
        p.property_code,
        p.property_name,
        c.category_name,
        l.location_name,
        bt.borrower_id,
        b.borrower_name,
        b.id_number,
        b.borrower_type,
        b.department,
        b.contact_number,
        bt.purpose,
        bt.expected_return_date,
        bt.released_at,
        bt.condition_on_release,
        CASE WHEN bt.expected_return_date < date('now', 'localtime') THEN 1 ELSE 0 END AS is_overdue,
        CASE WHEN bt.expected_return_date < date('now', 'localtime')
          THEN CAST(julianday(date('now', 'localtime')) - julianday(bt.expected_return_date) AS INTEGER)
          ELSE 0
        END AS days_overdue
      FROM borrow_transactions bt
      INNER JOIN properties p ON p.property_id = bt.property_id
      INNER JOIN categories c ON c.category_id = p.category_id
      INNER JOIN locations l ON l.location_id = p.location_id
      INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
      WHERE bt.transaction_status = 'Released'
      ORDER BY is_overdue DESC, bt.expected_return_date ASC;
    `);

    const nowStr = toSqlDateTime(new Date());
    const daysAgo = (d: number) => toSqlDateTime(new Date(Date.now() - d * 86400000));
    const dateOffset = (d: number) => toSqlDate(new Date(Date.now() + d * 86400000));

    const insertUser = db.prepare(
      'INSERT INTO users (username, password_hash, full_name, email, role, is_active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)'
    );
    insertUser.run('admin', hashSeedPassword('Admin@123'), 'Dr. Amirah Macapagal', 'admin@cics.msumain.edu.ph', 'admin', nowStr, nowStr);
    insertUser.run('custodian', hashSeedPassword('Custodian@123'), 'Engr. Hakim Pangandaman', 'custodian@cics.msumain.edu.ph', 'property_custodian', nowStr, nowStr);
    insertUser.run('staff1', hashSeedPassword('Staff@123'), 'Sittie Aisah Alonto', 'staff1@cics.msumain.edu.ph', 'staff', nowStr, nowStr);

    const insertCat = db.prepare('INSERT INTO categories (category_name, description, created_at) VALUES (?, ?, ?)');
    insertCat.run('Desktop Workstations', 'Laboratory and faculty desktop computers', nowStr);
    insertCat.run('Laptops & Tablets', 'Portable computing units for faculty and events', nowStr);
    insertCat.run('Audio-Visual Equipment', 'Projectors, smart boards, microphones, and cameras', nowStr);
    insertCat.run('Networking Hardware', 'Switches, routers, access points, and fiber testers', nowStr);
    insertCat.run('Lab Peripherals & IoT', 'Arduino kits, Raspberry Pi units, and sensors', nowStr);
    insertCat.run('Office Furniture & Fixtures', 'Ergonomic chairs, steel cabinets, and podiums', nowStr);

    const insertLoc = db.prepare('INSERT INTO locations (location_name, building, room_number, description, created_at) VALUES (?, ?, ?, ?, ?)');
    insertLoc.run("CICS Dean's Office", 'CICS Main Building', '101', 'Administrative headquarters', nowStr);
    insertLoc.run('IT Laboratory 1', 'CICS Main Building', '201', 'Primary undergraduate programming lab', nowStr);
    insertLoc.run('CS Research & AI Lab', 'CICS Main Building', '204', 'Senior thesis and research computing facility', nowStr);
    insertLoc.run('Property Custodian Stockroom', 'CICS Main Building', '105', 'Central asset storage and dispatch room', nowStr);
    insertLoc.run('CICS Smart Lecture Hall', 'CICS Annex', '301', 'Multimedia lecture and seminar venue', nowStr);
    insertLoc.run('Network & Security Lab', 'CICS Main Building', '206', 'Cisco and cybersecurity practicum room', nowStr);

    const insertProp = db.prepare(`
      INSERT INTO properties (
        property_code, property_name, description, category_id, brand, model,
        serial_number, acquisition_date, acquisition_cost, location_id,
        assigned_personnel, property_condition, property_status, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const seedProps: any[][] = [
      ['CICS-PRP-0001', 'Dell OptiPlex 7010 Tower', 'Core i7 workstation with 16GB RAM and 512GB NVMe SSD', 1, 'Dell', 'OptiPlex 7010', 'SN-DL7010-8841', '2025-02-14', 58500, 2, 'Lab Tech Yusoph', 'Good', 'Available', 1, daysAgo(20), daysAgo(20)],
      ['CICS-PRP-0002', 'Epson EB-X51 XGA Projector', '3800-lumen HDMI classroom multimedia projector', 3, 'Epson', 'EB-X51', 'SN-EPX51-3312', '2024-09-10', 32400, 4, 'Engr. Hakim Pangandaman', 'Good', 'Borrowed', 2, daysAgo(18), daysAgo(9)],
      ['CICS-PRP-0003', 'Lenovo ThinkPad T14 Gen 4', 'Faculty loaner laptop for thesis defense and conferences', 2, 'Lenovo', 'ThinkPad T14 G4', 'SN-LNT14-4410', '2025-06-20', 67900, 4, 'Engr. Hakim Pangandaman', 'Good', 'Borrowed', 2, daysAgo(15), daysAgo(2)],
      ['CICS-PRP-0004', 'Cisco Catalyst 2960-X 24-Port Switch', 'Managed Gigabit Ethernet switch for practicum racks', 4, 'Cisco', 'WS-C2960X-24TS-L', 'SN-CS2960-9902', '2024-03-05', 45000, 6, 'Prof. Khalid Bansuan', 'Good', 'Available', 1, daysAgo(14), daysAgo(14)],
      ['CICS-PRP-0005', 'Canon EOS R50 Mirrorless Camera Kit', 'Documentation camera with 18-45mm lens and tripod', 3, 'Canon', 'EOS R50', 'SN-CNR50-1129', '2025-01-18', 49500, 1, 'Sittie Aisah Alonto', 'Fair', 'Available', 2, daysAgo(12), daysAgo(12)],
      ['CICS-PRP-0006', 'HP ProDesk 400 G9 Mini', 'Compact research workstation with dual monitor mount', 1, 'HP', 'ProDesk 400 G9', 'SN-HPPD-7721', '2024-11-12', 42000, 3, 'Dr. Norhanie Dimaampao', 'Needs Repair', 'Under Maintenance', 2, daysAgo(10), daysAgo(3)],
      ['CICS-PRP-0007', 'Raspberry Pi 5 8GB Starter Kit', 'Embedded systems & IoT prototyping kit with case and PSU', 5, 'Raspberry Pi', 'Pi 5 Model B', 'SN-RPI5-5508', '2025-08-03', 7800, 3, 'Prof. Fahad Lucman', 'Good', 'Available', 2, daysAgo(8), daysAgo(8)],
      ['CICS-PRP-0008', 'Logitech Rally Bar Mini', 'Conference video bar for CICS Smart Lecture Hall', 3, 'Logitech', 'Rally Bar Mini', 'SN-LGRB-2041', '2024-07-22', 94000, 5, 'Engr. Hakim Pangandaman', 'Good', 'Missing', 1, daysAgo(7), daysAgo(1)],
      ['CICS-PRP-0009', 'Apple MacBook Air M3 13-inch', 'Mobile development unit for iOS & cross-platform lab', 2, 'Apple', 'MacBook Air M3', 'SN-APMBA-6619', '2025-09-15', 74900, 4, 'Engr. Hakim Pangandaman', 'Good', 'Available', 1, daysAgo(5), daysAgo(5)],
      ['CICS-PRP-0010', 'Fluke Networks MicroScanner2', 'Cable verifier and PoE network diagnostic tester', 4, 'Fluke', 'MS2-100', 'SN-FLK-3094', '2024-05-30', 29800, 6, 'Prof. Khalid Bansuan', 'Good', 'Available', 2, daysAgo(4), daysAgo(4)],
    ];
    for (const p of seedProps) {
      insertProp.run(...p);
    }

    const insertQr = db.prepare('INSERT INTO qr_codes (property_id, qr_value, barcode_value, generated_by, generated_at) VALUES (?, ?, ?, ?, ?)');
    seedProps.forEach((p, idx) => {
      insertQr.run(idx + 1, p[0], p[6], p[13], p[14]);
    });

    const insertBorrower = db.prepare('INSERT INTO borrowers (borrower_name, id_number, borrower_type, department, contact_number, email, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertBorrower.run('Prof. Aminah Sarip', 'FAC-2019-042', 'Faculty', 'Computer Science', '0917-555-0142', 'aminah.sarip@msumain.edu.ph', nowStr);
    insertBorrower.run('Engr. Jalaludin Macaumbos', 'FAC-2021-108', 'Faculty', 'Information Technology', '0918-555-0198', 'jalaludin.m@msumain.edu.ph', nowStr);
    insertBorrower.run('Farhanah Dimaporo', '2022-14582', 'Student', 'BSCS 4th Year', '0927-555-0174', 'farhanah.dimaporo@s.msumain.edu.ph', nowStr);

    const insertBorrow = db.prepare(`
      INSERT INTO borrow_transactions (
        transaction_code, property_id, borrower_id, purpose, expected_return_date,
        transaction_status, requested_by, requested_at, reviewed_by, reviewed_at,
        released_by, released_at, condition_on_release
      ) VALUES (?, ?, ?, ?, ?, 'Released', ?, ?, ?, ?, ?, ?, 'Good')
    `);
    insertBorrow.run('BRW-2026-0001', 2, 1, 'CS 142 Software Engineering Lecture Projection', dateOffset(-4), 2, daysAgo(9), 2, daysAgo(9), 2, daysAgo(9));
    insertBorrow.run('BRW-2026-0002', 3, 2, 'CICS Accreditation Document Presentation', dateOffset(5), 2, daysAgo(2), 2, daysAgo(2), 2, daysAgo(2));

    const insertUpdate = db.prepare('INSERT INTO property_updates (property_id, field_name, old_value, new_value, remarks, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
    insertUpdate.run(6, 'property_condition', 'Good', 'Needs Repair', 'Power supply fan intermittent noise reported during lab check', 2, daysAgo(3));
    insertUpdate.run(6, 'property_status', 'Available', 'Under Maintenance', 'Queued for PSU replacement', 2, daysAgo(3));
    insertUpdate.run(8, 'property_status', 'Available', 'Missing', 'Not found in Lecture Hall 301 cabinet after seminar', 1, daysAgo(1));

    const insertAudit = db.prepare('INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    insertAudit.run(1, 'admin', 'LOGIN_OK', 'users', 1, 'Initial system seed login verification', '127.0.0.1', daysAgo(4));
    insertAudit.run(2, 'custodian', 'BORROW_RELEASE', 'borrow_transactions', 1, 'Released CICS-PRP-0002 to Prof. Aminah Sarip', '192.168.1.14', daysAgo(9));
    insertAudit.run(2, 'custodian', 'UPDATE_PROPERTY', 'properties', 6, 'Marked CICS-PRP-0006 Under Maintenance (PSU fan)', '192.168.1.14', daysAgo(3));
    insertAudit.run(2, 'custodian', 'BORROW_RELEASE', 'borrow_transactions', 2, 'Released CICS-PRP-0003 to Engr. Jalaludin Macaumbos', '192.168.1.14', daysAgo(2));
    insertAudit.run(1, 'admin', 'UPDATE_PROPERTY', 'properties', 8, 'Flagged CICS-PRP-0008 as Missing during quarterly check', '192.168.1.10', daysAgo(1));
  }

  return db;
}

export async function initDatabase(): Promise<'mysql' | 'sqlite'> {
  const host = process.env.DB_HOST?.trim();
  const useMysql = Boolean(host) && process.env.DB_DRIVER !== 'sqlite';

  if (useMysql) {
    try {
      const pool = mysql.createPool({
        host,
        port: Number(process.env.DB_PORT || 3306),
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'cics_inventory',
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        dateStrings: true,
      });
      await pool.query('SELECT 1');
      mysqlPool = pool;
      activeMode = 'mysql';
      console.log(`[DB] Connected to MySQL (${host}:${process.env.DB_PORT || 3306}/${process.env.DB_NAME || 'cics_inventory'})`);
      return 'mysql';
    } catch (err: any) {
      console.warn(`[DB] MySQL connection unavailable (${err?.code || err?.message}). Falling back to local embedded SQLite store.`);
    }
  }

  sqliteDb = initSqliteFallback();
  activeMode = 'sqlite';
  console.log('[DB] Using embedded SQLite preview database (data/cics_preview.db)');
  return 'sqlite';
}

export function getDbMode(): 'mysql' | 'sqlite' {
  return activeMode;
}

function createSqliteExecutor(db: DatabaseSync): DbExecutor {
  return {
    async query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
      const stmt = db.prepare(sql);
      return stmt.all(...params) as T[];
    },
    async queryOne<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
      const stmt = db.prepare(sql);
      const row = stmt.get(...params) as T | undefined;
      return row ?? null;
    },
    async execute(sql: string, params: any[] = []): Promise<QueryResultMeta> {
      const stmt = db.prepare(sql);
      const res = stmt.run(...params);
      return {
        insertId: Number(res.lastInsertRowid || 0),
        affectedRows: Number(res.changes || 0),
      };
    },
  };
}

function createMysqlExecutor(conn: mysql.Pool | mysql.PoolConnection): DbExecutor {
  return {
    async query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
      const [rows] = await conn.query(sql, params);
      return rows as T[];
    },
    async queryOne<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
      const [rows] = await conn.query(sql, params);
      const arr = rows as T[];
      return arr.length > 0 ? arr[0] : null;
    },
    async execute(sql: string, params: any[] = []): Promise<QueryResultMeta> {
      const [result] = await conn.execute(sql, params);
      const header = result as mysql.ResultSetHeader;
      return {
        insertId: Number(header.insertId || 0),
        affectedRows: Number(header.affectedRows || 0),
      };
    },
  };
}

export const db: DbExecutor = {
  query<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T[]> {
    if (activeMode === 'mysql' && mysqlPool) {
      return createMysqlExecutor(mysqlPool).query<T>(sql, params);
    }
    if (!sqliteDb) throw new Error('Database not initialized');
    return createSqliteExecutor(sqliteDb).query<T>(sql, params);
  },
  queryOne<T = Record<string, any>>(sql: string, params: any[] = []): Promise<T | null> {
    if (activeMode === 'mysql' && mysqlPool) {
      return createMysqlExecutor(mysqlPool).queryOne<T>(sql, params);
    }
    if (!sqliteDb) throw new Error('Database not initialized');
    return createSqliteExecutor(sqliteDb).queryOne<T>(sql, params);
  },
  execute(sql: string, params: any[] = []): Promise<QueryResultMeta> {
    if (activeMode === 'mysql' && mysqlPool) {
      return createMysqlExecutor(mysqlPool).execute(sql, params);
    }
    if (!sqliteDb) throw new Error('Database not initialized');
    return createSqliteExecutor(sqliteDb).execute(sql, params);
  },
};

export async function withTransaction<T>(fn: (tx: DbExecutor) => Promise<T>): Promise<T> {
  if (activeMode === 'mysql' && mysqlPool) {
    const conn = await mysqlPool.getConnection();
    try {
      await conn.beginTransaction();
      const result = await fn(createMysqlExecutor(conn));
      await conn.commit();
      return result;
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  if (!sqliteDb) throw new Error('Database not initialized');
  sqliteDb.exec('BEGIN IMMEDIATE');
  try {
    const result = await fn(createSqliteExecutor(sqliteDb));
    sqliteDb.exec('COMMIT');
    return result;
  } catch (err) {
    sqliteDb.exec('ROLLBACK');
    throw err;
  }
}
