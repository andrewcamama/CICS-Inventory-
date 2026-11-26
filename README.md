# Inventory and Asset Tracking Management System for CICS with QR Code

College of Information and Computing Sciences (CICS) — Mindanao State University - Main Campus.
Built for CICS Local Area Network (LAN) deployment with role-based access for **Admin**, **Property Custodian**, and **Office Staff**.

---

## 1. Prerequisites & XAMPP / MySQL Setup

1. Install **Node.js 20+** (Node 22+ recommended) and **XAMPP** (Apache + MySQL/MariaDB).
2. Open the **XAMPP Control Panel** and start **MySQL**.
3. Open **phpMyAdmin** (`http://localhost/phpmyadmin`) or the MySQL CLI:
   - Click **Import** in phpMyAdmin (or run from terminal):
     ```bash
     mysql -u root -p < cics_inventory_schema.sql
     ```
   - Verify that the database `cics_inventory` is created along with its tables (`users`, `categories`, `locations`, `properties`, `qr_codes`, `property_updates`, `borrowers`, `borrow_transactions`, `scan_logs`, `audit_logs`, `inventory_reports`), views (`v_inventory_summary`, `v_active_borrowings`), and seed records.

> **Note on Sandbox / Offline Preview:** If `DB_HOST` is omitted or MySQL is not reachable at startup, the server automatically initializes a local SQLite database (`data/cics_preview.db`) with the identical schema, views, and seed data so the application remains testable without XAMPP. When running on your CICS XAMPP server, keep `DB_HOST=127.0.0.1` (or your MySQL host) in `.env` so it connects to MySQL via `mysql2`.

---

## 2. Environment Configuration (`.env`)

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

Update `.env` with your local values:

```env
DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=cics_inventory

PORT=3000
JWT_SECRET=replace_with_a_64_char_random_secret_string
ALLOWED_ORIGIN=https://192.168.1.50:3000

HTTPS_ENABLED=false
SSL_KEY_PATH=./certs/lan-key.pem
SSL_CERT_PATH=./certs/lan-cert.pem
```

---

## 3. Install Dependencies & Run

```bash
npm install
```

### Development Mode (Express API + Vite on Port 3000)
```bash
npm run dev
```

### Production Build & Start
```bash
npm run build
NODE_ENV=production npm start
```

Open `http://localhost:3000` (for local testing) or `https://<YOUR_LAN_IP>:3000` (once LAN HTTPS is enabled below).

---

## 4. Finding Your Server's LAN IP Address

- **Windows (Command Prompt / PowerShell):**
  ```cmd
  ipconfig
  ```
  Look under your active Wi-Fi or Ethernet adapter for **IPv4 Address** (e.g., `192.168.1.50`).
- **macOS:**
  ```bash
  ipconfig getifaddr en0
  ```
- **Linux:**
  ```bash
  hostname -I
  ```

---

## 5. Serving Over HTTPS on the CICS LAN (Required for Mobile Camera QR Scanning)

Modern browsers block `navigator.mediaDevices.getUserMedia` (camera access) on plain HTTP LAN addresses (`http://192.168.x.x`). Serving both the Express API and React frontend over **HTTPS on port 3000** solves this cleanly.

### Option A: Using `mkcert` (Recommended for LAN)

1. Install `mkcert` on the host machine:
   - Windows (Chocolatey): `choco install mkcert` or download from `github.com/FiloSottile/mkcert/releases`
   - macOS: `brew install mkcert`
   - Linux: `sudo apt install mkcert` (or download binary)
2. Initialize the local Certificate Authority (CA):
   ```bash
   mkcert -install
   ```
3. Generate a certificate for `localhost` and your server's LAN IP (replace `192.168.1.50` with your actual LAN IP):
   ```bash
   mkdir -p certs
   mkcert -key-file certs/lan-key.pem -cert-file certs/lan-cert.pem localhost 127.0.0.1 192.168.1.50
   ```
4. Enable HTTPS in `.env`:
   ```env
   HTTPS_ENABLED=true
   SSL_KEY_PATH=./certs/lan-key.pem
   SSL_CERT_PATH=./certs/lan-cert.pem
   ALLOWED_ORIGIN=https://192.168.1.50:3000
   ```
5. Restart the server (`npm run dev` or `NODE_ENV=production npm start`). It will now listen on `https://0.0.0.0:3000`.

### Option B: Using OpenSSL Self-Signed Certificate (If `mkcert` is unavailable)

```bash
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout certs/lan-key.pem -out certs/lan-cert.pem -days 365 \
  -subj "/CN=192.168.1.50" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.50"
```

### Installing the Certificate on Phones & Laptops

If using `mkcert`, find your CA root certificate path via `mkcert -CAROOT` (the file is `rootCA.pem`). Share `rootCA.pem` (or `certs/lan-cert.pem` if using OpenSSL) to CICS staff devices over USB or local file share:

- **Android Phones:**
  1. Copy `rootCA.pem` (rename to `rootCA.crt` if Android requires `.crt`) to phone storage.
  2. Open **Settings → Security & privacy → More security settings → Encryption & credentials → Install a certificate → CA certificate**.
  3. Select `rootCA.crt` and confirm. Restart Chrome and visit `https://192.168.1.50:3000`.
- **iPhone / iPad (iOS/iPadOS):**
  1. Transfer `rootCA.pem` via AirDrop or local HTTP download.
  2. Open **Settings → General → VPN & Device Management**, tap the downloaded profile, and install it.
  3. Open **Settings → General → About → Certificate Trust Settings** and toggle **ON** full trust for the `mkcert` root certificate.
- **Windows Laptops:**
  1. Double-click `rootCA.pem` (or rename to `.crt`) → **Install Certificate** → **Local Machine** → **Place all certificates in the following store** → **Trusted Root Certification Authorities**.
- **macOS Laptops:**
  1. Double-click `rootCA.pem` to open **Keychain Access**, add to **System** keychain, then double-click the certificate → **Trust** → **Always Trust**.

> **USB Barcode Scanners & Manual Fallback:** Every scan screen also accepts keyboard-wedge USB barcode scanners (focus the Property ID field and scan; it submits on `Enter`) as well as manual Property Code or Serial Number entry.

---

## 6. Default Test Accounts

| Role | Username | Password | Access Scope |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `Admin@123` | Full access + User, Category, Location & Log Management |
| **Property Custodian** | `custodian` | `Custodian@123` | Dashboard, Property Management, Monitoring, Borrowing/Returning, Reports |
| **Office Staff** | `staff1` | `Staff@123` | Dashboard, Property Monitoring (read-only), Inventory Reports |

---

## 7. Verification & Test Checklist

1. **Authentication & Lockout**
   - [ ] Sign in with `admin / Admin@123` → lands on Dashboard; `LOGIN_OK` written to `audit_logs`.
   - [ ] Sign out, enter wrong password 5 times for `staff1` → `LOGIN_FAILED` logged per attempt, account locks for 15 minutes (`locked_until` set), 6th attempt shows lockout message.
   - [ ] Unlock `staff1` via Admin Settings → Users, and verify `staff1 / Staff@123` sees only Dashboard, Property Monitoring, and Inventory Reports.
   - [ ] Deactivate a test user (`is_active = 0`) and confirm login is rejected with HTTP 403.
2. **Module A: Property Management**
   - [ ] Open **Property Management** → choose **Yes (New Property)** → verify auto-suggested `CICS-PRP-####` code → fill details and save → printable QR label modal opens → click **Print QR Label** → click **Save Property Record & Return to Dashboard**.
   - [ ] Open **Property Management** → choose **No (Existing Property)** → test camera QR scan or manual ID fallback (`CICS-PRP-0001`) → verify entry in `scan_logs` → choose **Yes — Update Record**, change location/condition, save → verify rows in `property_updates` and `audit_logs`.
   - [ ] Filter the Property Registry table by Category, Location, Status, and Condition, paginate, and click **Reprint QR**.
3. **Module B: Property Monitoring**
   - [ ] As `staff1`, scan or enter `CICS-PRP-0002` → verify Condition, Status, Location, Assigned Personnel, and Borrowing History are displayed with no edit button.
   - [ ] As `custodian`, scan or enter `CICS-PRP-0006` → click **Yes — Update Monitoring Details** → update condition/location and verify `property_updates` records the change.
4. **Module C: Borrowing & Returning**
   - [ ] **Borrow Approve:** Select **Borrowing** → scan/enter an `Available` property (`CICS-PRP-0001`) → pick or create borrower, enter purpose & due date → submit Pending request → click **Yes — Approve & Release Property** → verify status becomes `Released` and property becomes `Borrowed`.
   - [ ] **Borrow Reject:** Submit another Pending request → click **No — Reject Request** with a reason → verify status is `Rejected` and "Do Not Release Property" notice appears.
   - [ ] **Return (Good & Complete):** Select **Returning** → scan/enter `CICS-PRP-0002` → check complete checkbox + select `Good` → confirm return → verify transaction is `Returned` and property status returns to `Available`.
   - [ ] **Return (Damaged / Incomplete):** Return a borrowed item with `Damaged` (or unchecked complete box) → verify property status automatically becomes `Under Maintenance` and `property_condition` updates.
5. **Module D: Inventory Reports**
   - [ ] Open **Inventory Reports** → test `Monthly`, `Quarterly`, `Annual`, and `Custom` date ranges → click **Generate Report** → verify totals, category/location tables, overdue items, and condition changes.
   - [ ] Click **Export PDF** and **Export Excel** → verify downloaded `.pdf` and `.xlsx` files open cleanly and rows are saved in `inventory_reports` + `audit_logs`.
