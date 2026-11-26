-- ============================================================================
-- CICS Inventory and Asset Tracking Management System with QR Code
-- College of Information and Computing Sciences (CICS)
-- Mindanao State University - Main Campus, Marawi City
-- Compatible with MySQL 8.0+ / MariaDB 10.4+ (XAMPP)
-- ============================================================================

CREATE DATABASE IF NOT EXISTS `cics_inventory`
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE `cics_inventory`;

SET FOREIGN_KEY_CHECKS = 0;

DROP VIEW IF EXISTS `v_active_borrowings`;
DROP VIEW IF EXISTS `v_inventory_summary`;
DROP TABLE IF EXISTS `inventory_reports`;
DROP TABLE IF EXISTS `audit_logs`;
DROP TABLE IF EXISTS `scan_logs`;
DROP TABLE IF EXISTS `borrow_transactions`;
DROP TABLE IF EXISTS `borrowers`;
DROP TABLE IF EXISTS `property_updates`;
DROP TABLE IF EXISTS `qr_codes`;
DROP TABLE IF EXISTS `properties`;
DROP TABLE IF EXISTS `locations`;
DROP TABLE IF EXISTS `categories`;
DROP TABLE IF EXISTS `users`;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------------------------
-- 1. Users
-- ----------------------------------------------------------------------------
CREATE TABLE `users` (
  `user_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `username` VARCHAR(60) NOT NULL,
  `password_hash` VARCHAR(255) NOT NULL,
  `full_name` VARCHAR(120) NOT NULL,
  `email` VARCHAR(150) NULL,
  `role` ENUM('admin', 'property_custodian', 'staff') NOT NULL DEFAULT 'staff',
  `is_active` TINYINT(1) NOT NULL DEFAULT 1,
  `failed_logins` INT UNSIGNED NOT NULL DEFAULT 0,
  `locked_until` DATETIME NULL,
  `last_login_at` DATETIME NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `uq_users_username` (`username`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 2. Categories
-- ----------------------------------------------------------------------------
CREATE TABLE `categories` (
  `category_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `category_name` VARCHAR(100) NOT NULL,
  `description` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`category_id`),
  UNIQUE KEY `uq_categories_name` (`category_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 3. Locations
-- ----------------------------------------------------------------------------
CREATE TABLE `locations` (
  `location_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `location_name` VARCHAR(120) NOT NULL,
  `building` VARCHAR(100) NOT NULL DEFAULT 'CICS Building',
  `room_number` VARCHAR(40) NULL,
  `description` VARCHAR(255) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`location_id`),
  UNIQUE KEY `uq_locations_name` (`location_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 4. Properties
-- ----------------------------------------------------------------------------
CREATE TABLE `properties` (
  `property_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `property_code` VARCHAR(40) NOT NULL,
  `property_name` VARCHAR(160) NOT NULL,
  `description` TEXT NULL,
  `category_id` INT UNSIGNED NOT NULL,
  `brand` VARCHAR(100) NULL,
  `model` VARCHAR(100) NULL,
  `serial_number` VARCHAR(120) NULL,
  `acquisition_date` DATE NULL,
  `acquisition_cost` DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  `location_id` INT UNSIGNED NOT NULL,
  `assigned_personnel` VARCHAR(150) NULL,
  `property_condition` ENUM('Good', 'Fair', 'Needs Repair', 'Damaged', 'Condemned') NOT NULL DEFAULT 'Good',
  `property_status` ENUM('Available', 'Borrowed', 'Under Maintenance', 'Missing', 'Disposed') NOT NULL DEFAULT 'Available',
  `created_by` INT UNSIGNED NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`property_id`),
  UNIQUE KEY `uq_properties_code` (`property_code`),
  KEY `idx_properties_serial` (`serial_number`),
  KEY `idx_properties_status` (`property_status`),
  KEY `idx_properties_condition` (`property_condition`),
  CONSTRAINT `fk_properties_category` FOREIGN KEY (`category_id`) REFERENCES `categories` (`category_id`),
  CONSTRAINT `fk_properties_location` FOREIGN KEY (`location_id`) REFERENCES `locations` (`location_id`),
  CONSTRAINT `fk_properties_creator` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 5. QR Codes
-- ----------------------------------------------------------------------------
CREATE TABLE `qr_codes` (
  `qr_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `property_id` INT UNSIGNED NOT NULL,
  `qr_value` VARCHAR(120) NOT NULL,
  `barcode_value` VARCHAR(120) NULL,
  `qr_image_data` LONGTEXT NULL,
  `generated_by` INT UNSIGNED NULL,
  `generated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`qr_id`),
  UNIQUE KEY `uq_qr_property` (`property_id`),
  UNIQUE KEY `uq_qr_value` (`qr_value`),
  KEY `idx_qr_barcode` (`barcode_value`),
  CONSTRAINT `fk_qr_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`property_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_qr_user` FOREIGN KEY (`generated_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 6. Property Updates History
-- ----------------------------------------------------------------------------
CREATE TABLE `property_updates` (
  `update_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `property_id` INT UNSIGNED NOT NULL,
  `field_name` VARCHAR(80) NOT NULL,
  `old_value` TEXT NULL,
  `new_value` TEXT NULL,
  `remarks` VARCHAR(255) NULL,
  `updated_by` INT UNSIGNED NULL,
  `updated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`update_id`),
  KEY `idx_pu_property` (`property_id`),
  KEY `idx_pu_updated_at` (`updated_at`),
  CONSTRAINT `fk_pu_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`property_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_pu_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 7. Borrowers
-- ----------------------------------------------------------------------------
CREATE TABLE `borrowers` (
  `borrower_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `borrower_name` VARCHAR(150) NOT NULL,
  `id_number` VARCHAR(60) NOT NULL,
  `borrower_type` ENUM('Faculty', 'Staff', 'Student', 'Guest') NOT NULL DEFAULT 'Faculty',
  `department` VARCHAR(120) NOT NULL DEFAULT 'CICS',
  `contact_number` VARCHAR(40) NULL,
  `email` VARCHAR(150) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`borrower_id`),
  KEY `idx_borrower_id_number` (`id_number`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 8. Borrow Transactions
-- ----------------------------------------------------------------------------
CREATE TABLE `borrow_transactions` (
  `transaction_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `transaction_code` VARCHAR(40) NOT NULL,
  `property_id` INT UNSIGNED NOT NULL,
  `borrower_id` INT UNSIGNED NOT NULL,
  `purpose` VARCHAR(255) NOT NULL,
  `expected_return_date` DATE NOT NULL,
  `transaction_status` ENUM('Pending', 'Rejected', 'Released', 'Returned') NOT NULL DEFAULT 'Pending',
  `rejection_reason` TEXT NULL,
  `requested_by` INT UNSIGNED NULL,
  `requested_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `reviewed_by` INT UNSIGNED NULL,
  `reviewed_at` DATETIME NULL,
  `released_by` INT UNSIGNED NULL,
  `released_at` DATETIME NULL,
  `condition_on_release` VARCHAR(50) NULL,
  `received_by` INT UNSIGNED NULL,
  `returned_at` DATETIME NULL,
  `condition_on_return` VARCHAR(50) NULL,
  `is_complete_on_return` TINYINT(1) NULL,
  `return_remarks` TEXT NULL,
  PRIMARY KEY (`transaction_id`),
  UNIQUE KEY `uq_bt_code` (`transaction_code`),
  KEY `idx_bt_property_status` (`property_id`, `transaction_status`),
  KEY `idx_bt_expected_return` (`expected_return_date`),
  CONSTRAINT `fk_bt_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`property_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_bt_borrower` FOREIGN KEY (`borrower_id`) REFERENCES `borrowers` (`borrower_id`),
  CONSTRAINT `fk_bt_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_bt_reviewed_by` FOREIGN KEY (`reviewed_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_bt_released_by` FOREIGN KEY (`released_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_bt_received_by` FOREIGN KEY (`received_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 9. Scan Logs
-- ----------------------------------------------------------------------------
CREATE TABLE `scan_logs` (
  `scan_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `scanned_code` VARCHAR(160) NOT NULL,
  `scan_method` ENUM('QR', 'Barcode', 'Manual') NOT NULL DEFAULT 'QR',
  `module` VARCHAR(80) NOT NULL,
  `property_id` INT UNSIGNED NULL,
  `scanned_by` INT UNSIGNED NULL,
  `is_successful` TINYINT(1) NOT NULL DEFAULT 0,
  `scanned_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`scan_id`),
  KEY `idx_sl_scanned_at` (`scanned_at`),
  CONSTRAINT `fk_sl_property` FOREIGN KEY (`property_id`) REFERENCES `properties` (`property_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_sl_user` FOREIGN KEY (`scanned_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 10. Audit Logs
-- ----------------------------------------------------------------------------
CREATE TABLE `audit_logs` (
  `audit_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `user_id` INT UNSIGNED NULL,
  `username` VARCHAR(100) NULL,
  `action` VARCHAR(80) NOT NULL,
  `entity_type` VARCHAR(80) NULL,
  `entity_id` INT UNSIGNED NULL,
  `details` TEXT NULL,
  `ip_address` VARCHAR(64) NULL,
  `created_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`audit_id`),
  KEY `idx_al_created_at` (`created_at`),
  KEY `idx_al_action` (`action`),
  CONSTRAINT `fk_al_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- 11. Inventory Reports
-- ----------------------------------------------------------------------------
CREATE TABLE `inventory_reports` (
  `report_id` INT UNSIGNED NOT NULL AUTO_INCREMENT,
  `report_title` VARCHAR(160) NOT NULL,
  `period_type` ENUM('Monthly', 'Quarterly', 'Annual', 'Custom') NOT NULL,
  `start_date` DATE NOT NULL,
  `end_date` DATE NOT NULL,
  `total_properties` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_available` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_borrowed` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_maintenance` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_missing` INT UNSIGNED NOT NULL DEFAULT 0,
  `total_overdue` INT UNSIGNED NOT NULL DEFAULT 0,
  `export_format` ENUM('Screen', 'PDF', 'Excel') NOT NULL DEFAULT 'Screen',
  `generated_by` INT UNSIGNED NULL,
  `generated_at` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`report_id`),
  CONSTRAINT `fk_ir_user` FOREIGN KEY (`generated_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ----------------------------------------------------------------------------
-- Views
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW `v_inventory_summary` AS
SELECT
  c.category_id,
  c.category_name,
  COUNT(p.property_id) AS total_count,
  SUM(CASE WHEN p.property_status = 'Available' THEN 1 ELSE 0 END) AS available_count,
  SUM(CASE WHEN p.property_status = 'Borrowed' THEN 1 ELSE 0 END) AS borrowed_count,
  SUM(CASE WHEN p.property_status = 'Under Maintenance' THEN 1 ELSE 0 END) AS maintenance_count,
  SUM(CASE WHEN p.property_status = 'Missing' THEN 1 ELSE 0 END) AS missing_count,
  SUM(CASE WHEN p.property_status = 'Disposed' THEN 1 ELSE 0 END) AS disposed_count,
  COALESCE(SUM(p.acquisition_cost), 0) AS total_value
FROM categories c
LEFT JOIN properties p ON p.category_id = c.category_id
GROUP BY c.category_id, c.category_name
ORDER BY total_count DESC, c.category_name ASC;

CREATE OR REPLACE VIEW `v_active_borrowings` AS
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
  CASE WHEN bt.expected_return_date < CURDATE() THEN 1 ELSE 0 END AS is_overdue,
  CASE WHEN bt.expected_return_date < CURDATE() THEN DATEDIFF(CURDATE(), bt.expected_return_date) ELSE 0 END AS days_overdue
FROM borrow_transactions bt
INNER JOIN properties p ON p.property_id = bt.property_id
INNER JOIN categories c ON c.category_id = p.category_id
INNER JOIN locations l ON l.location_id = p.location_id
INNER JOIN borrowers b ON b.borrower_id = bt.borrower_id
WHERE bt.transaction_status = 'Released'
ORDER BY is_overdue DESC, bt.expected_return_date ASC;

-- ----------------------------------------------------------------------------
-- Seed Data
-- Default test accounts:
--   admin / Admin@123
--   custodian / Custodian@123
--   staff1 / Staff@123
-- ----------------------------------------------------------------------------
INSERT INTO `users` (`username`, `password_hash`, `full_name`, `email`, `role`, `is_active`) VALUES
('admin', 'scrypt$16384$8$1$ba095e52267c294b0f1cfbf542d927ad$7f1a23dd8857d77321da07764ce7c53d6f2d1a737addc3fea1e65c7c310a6c1c5e9b15eeb627bbc029c7316367c5048746534fe448be066439f23f2d1795ae16', 'Dr. Amirah Macapagal', 'admin@cics.msumain.edu.ph', 'admin', 1),
('custodian', 'scrypt$16384$8$1$45c8a14cdc51f86a0479956cba3eeec2$6b36b34154f334feec47026d5dccefdd939e18f6f6b4c33281cedbb9aed94e61149c91362960f55e24be7fbf2b0f0b06f56643bc852533cd1d0be69073d5b402', 'Engr. Hakim Pangandaman', 'custodian@cics.msumain.edu.ph', 'property_custodian', 1),
('staff1', 'scrypt$16384$8$1$c3aa45647bc21ea015902cdd0c30ec72$0f2e16614782d1762484d6172c33e5ade8d9ec27a025ee1079ed06c7b357ce3d39c668bb61a8302a174691e5bfbb63310c39207aac1c3d70dab7ede6ed14b48a', 'Sittie Aisah Alonto', 'staff1@cics.msumain.edu.ph', 'staff', 1);

INSERT INTO `categories` (`category_name`, `description`) VALUES
('Desktop Workstations', 'Laboratory and faculty desktop computers'),
('Laptops & Tablets', 'Portable computing units for faculty and events'),
('Audio-Visual Equipment', 'Projectors, smart boards, microphones, and cameras'),
('Networking Hardware', 'Switches, routers, access points, and fiber testers'),
('Lab Peripherals & IoT', 'Arduino kits, Raspberry Pi units, and sensors'),
('Office Furniture & Fixtures', 'Ergonomic chairs, steel cabinets, and podiums');

INSERT INTO `locations` (`location_name`, `building`, `room_number`, `description`) VALUES
('CICS Dean\'s Office', 'CICS Main Building', '101', 'Administrative headquarters'),
('IT Laboratory 1', 'CICS Main Building', '201', 'Primary undergraduate programming lab'),
('CS Research & AI Lab', 'CICS Main Building', '204', 'Senior thesis and research computing facility'),
('Property Custodian Stockroom', 'CICS Main Building', '105', 'Central asset storage and dispatch room'),
('CICS Smart Lecture Hall', 'CICS Annex', '301', 'Multimedia lecture and seminar venue'),
('Network & Security Lab', 'CICS Main Building', '206', 'Cisco and cybersecurity practicum room');

INSERT INTO `properties` (`property_code`, `property_name`, `description`, `category_id`, `brand`, `model`, `serial_number`, `acquisition_date`, `acquisition_cost`, `location_id`, `assigned_personnel`, `property_condition`, `property_status`, `created_by`) VALUES
('CICS-PRP-0001', 'Dell OptiPlex 7010 Tower', 'Core i7 workstation with 16GB RAM and 512GB NVMe SSD', 1, 'Dell', 'OptiPlex 7010', 'SN-DL7010-8841', '2025-02-14', 58500.00, 2, 'Lab Tech Yusoph', 'Good', 'Available', 1),
('CICS-PRP-0002', 'Epson EB-X51 XGA Projector', '3800-lumen HDMI classroom multimedia projector', 3, 'Epson', 'EB-X51', 'SN-EPX51-3312', '2024-09-10', 32400.00, 4, 'Engr. Hakim Pangandaman', 'Good', 'Borrowed', 2),
('CICS-PRP-0003', 'Lenovo ThinkPad T14 Gen 4', 'Faculty loaner laptop for thesis defense and conferences', 2, 'Lenovo', 'ThinkPad T14 G4', 'SN-LNT14-4410', '2025-06-20', 67900.00, 4, 'Engr. Hakim Pangandaman', 'Good', 'Borrowed', 2),
('CICS-PRP-0004', 'Cisco Catalyst 2960-X 24-Port Switch', 'Managed Gigabit Ethernet switch for practicum racks', 4, 'Cisco', 'WS-C2960X-24TS-L', 'SN-CS2960-9902', '2024-03-05', 45000.00, 6, 'Prof. Khalid Bansuan', 'Good', 'Available', 1),
('CICS-PRP-0005', 'Canon EOS R50 Mirrorless Camera Kit', 'Documentation camera with 18-45mm lens and tripod', 3, 'Canon', 'EOS R50', 'SN-CNR50-1129', '2025-01-18', 49500.00, 1, 'Sittie Aisah Alonto', 'Fair', 'Available', 2),
('CICS-PRP-0006', 'HP ProDesk 400 G9 Mini', 'Compact research workstation with dual monitor mount', 1, 'HP', 'ProDesk 400 G9', 'SN-HPPD-7721', '2024-11-12', 42000.00, 3, 'Dr. Norhanie Dimaampao', 'Needs Repair', 'Under Maintenance', 2),
('CICS-PRP-0007', 'Raspberry Pi 5 8GB Starter Kit', 'Embedded systems & IoT prototyping kit with case and PSU', 5, 'Raspberry Pi', 'Pi 5 Model B', 'SN-RPI5-5508', '2025-08-03', 7800.00, 3, 'Prof. Fahad Lucman', 'Good', 'Available', 2),
('CICS-PRP-0008', 'Logitech Rally Bar Mini', 'Conference video bar for CICS Smart Lecture Hall', 3, 'Logitech', 'Rally Bar Mini', 'SN-LGRB-2041', '2024-07-22', 94000.00, 5, 'Engr. Hakim Pangandaman', 'Good', 'Missing', 1),
('CICS-PRP-0009', 'Apple MacBook Air M3 13-inch', 'Mobile development unit for iOS & cross-platform lab', 2, 'Apple', 'MacBook Air M3', 'SN-APMBA-6619', '2025-09-15', 74900.00, 4, 'Engr. Hakim Pangandaman', 'Good', 'Available', 1),
('CICS-PRP-0010', 'Fluke Networks MicroScanner2', 'Cable verifier and PoE network diagnostic tester', 4, 'Fluke', 'MS2-100', 'SN-FLK-3094', '2024-05-30', 29800.00, 6, 'Prof. Khalid Bansuan', 'Good', 'Available', 2);

INSERT INTO `qr_codes` (`property_id`, `qr_value`, `barcode_value`, `generated_by`) VALUES
(1, 'CICS-PRP-0001', 'SN-DL7010-8841', 1),
(2, 'CICS-PRP-0002', 'SN-EPX51-3312', 2),
(3, 'CICS-PRP-0003', 'SN-LNT14-4410', 2),
(4, 'CICS-PRP-0004', 'SN-CS2960-9902', 1),
(5, 'CICS-PRP-0005', 'SN-CNR50-1129', 2),
(6, 'CICS-PRP-0006', 'SN-HPPD-7721', 2),
(7, 'CICS-PRP-0007', 'SN-RPI5-5508', 2),
(8, 'CICS-PRP-0008', 'SN-LGRB-2041', 1),
(9, 'CICS-PRP-0009', 'SN-APMBA-6619', 1),
(10, 'CICS-PRP-0010', 'SN-FLK-3094', 2);

INSERT INTO `borrowers` (`borrower_name`, `id_number`, `borrower_type`, `department`, `contact_number`, `email`) VALUES
('Prof. Aminah Sarip', 'FAC-2019-042', 'Faculty', 'Computer Science', '0917-555-0142', 'aminah.sarip@msumain.edu.ph'),
('Engr. Jalaludin Macaumbos', 'FAC-2021-108', 'Faculty', 'Information Technology', '0918-555-0198', 'jalaludin.m@msumain.edu.ph'),
('Farhanah Dimaporo', '2022-14582', 'Student', 'BSCS 4th Year', '0927-555-0174', 'farhanah.dimaporo@s.msumain.edu.ph');

INSERT INTO `borrow_transactions` (`transaction_code`, `property_id`, `borrower_id`, `purpose`, `expected_return_date`, `transaction_status`, `requested_by`, `requested_at`, `reviewed_by`, `reviewed_at`, `released_by`, `released_at`, `condition_on_release`) VALUES
('BRW-2026-0001', 2, 1, 'CS 142 Software Engineering Lecture Projection', DATE_SUB(CURDATE(), INTERVAL 4 DAY), 'Released', 2, DATE_SUB(NOW(), INTERVAL 9 DAY), 2, DATE_SUB(NOW(), INTERVAL 9 DAY), 2, DATE_SUB(NOW(), INTERVAL 9 DAY), 'Good'),
('BRW-2026-0002', 3, 2, 'CICS Accreditation Document Presentation', DATE_ADD(CURDATE(), INTERVAL 5 DAY), 'Released', 2, DATE_SUB(NOW(), INTERVAL 2 DAY), 2, DATE_SUB(NOW(), INTERVAL 2 DAY), 2, DATE_SUB(NOW(), INTERVAL 2 DAY), 'Good');

INSERT INTO `property_updates` (`property_id`, `field_name`, `old_value`, `new_value`, `remarks`, `updated_by`, `updated_at`) VALUES
(6, 'property_condition', 'Good', 'Needs Repair', 'Power supply fan intermittent noise reported during lab check', 2, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(6, 'property_status', 'Available', 'Under Maintenance', 'Queued for PSU replacement', 2, DATE_SUB(NOW(), INTERVAL 3 DAY)),
(8, 'property_status', 'Available', 'Missing', 'Not found in Lecture Hall 301 cabinet after seminar', 1, DATE_SUB(NOW(), INTERVAL 1 DAY));

INSERT INTO `audit_logs` (`user_id`, `username`, `action`, `entity_type`, `entity_id`, `details`, `ip_address`, `created_at`) VALUES
(1, 'admin', 'LOGIN_OK', 'users', 1, 'Initial system seed login verification', '127.0.0.1', DATE_SUB(NOW(), INTERVAL 4 DAY)),
(2, 'custodian', 'BORROW_RELEASE', 'borrow_transactions', 1, 'Released CICS-PRP-0002 to Prof. Aminah Sarip', '192.168.1.14', DATE_SUB(NOW(), INTERVAL 9 DAY)),
(2, 'custodian', 'UPDATE_PROPERTY', 'properties', 6, 'Marked CICS-PRP-0006 Under Maintenance (PSU fan)', '192.168.1.14', DATE_SUB(NOW(), INTERVAL 3 DAY)),
(2, 'custodian', 'BORROW_RELEASE', 'borrow_transactions', 2, 'Released CICS-PRP-0003 to Engr. Jalaludin Macaumbos', '192.168.1.14', DATE_SUB(NOW(), INTERVAL 2 DAY)),
(1, 'admin', 'UPDATE_PROPERTY', 'properties', 8, 'Flagged CICS-PRP-0008 as Missing during quarterly check', '192.168.1.10', DATE_SUB(NOW(), INTERVAL 1 DAY));
