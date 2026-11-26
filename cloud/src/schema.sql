-- Madhuram cloud – MySQL / MariaDB schema (InnoDB, utf8mb4). Applied automatically at start; safe to run again.
-- Money: DECIMAL(12,2) rupees. Quantities: DECIMAL(12,3) (pieces or kg). Times: Asia/Kolkata local time.

CREATE TABLE IF NOT EXISTS settings (
  k VARCHAR(60) PRIMARY KEY,
  v TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  role VARCHAR(12) NOT NULL,
  pass_hash VARCHAR(200) NOT NULL,
  pin_hash VARCHAR(200) NOT NULL DEFAULT '',
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id CHAR(64) PRIMARY KEY,
  user_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS failures (
  ident VARCHAR(160) NOT NULL,
  at DATETIME NOT NULL,
  INDEX (ident, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS categories (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE,
  department VARCHAR(60) NOT NULL DEFAULT ''
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sku VARCHAR(20) NOT NULL UNIQUE,
  plu VARCHAR(8) NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  name_ta VARCHAR(160) NOT NULL DEFAULT '',
  category_id INT NULL,
  unit VARCHAR(3) NOT NULL DEFAULT 'pcs',
  price DECIMAL(10,2) NULL,
  mrp DECIMAL(10,2) NULL,
  cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  tax_class VARCHAR(8) NOT NULL DEFAULT 'unset',
  hsn VARCHAR(8) NOT NULL DEFAULT '',
  reorder_level DECIMAL(12,3) NOT NULL DEFAULT 0,
  on_hand DECIMAL(12,3) NOT NULL DEFAULT 0,
  active TINYINT NOT NULL DEFAULT 0,
  updated_at DATETIME NOT NULL,
  INDEX (active), INDEX (name), INDEX (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS barcodes (
  code VARCHAR(32) PRIMARY KEY,
  item_id INT NOT NULL,
  per DECIMAL(10,3) NOT NULL DEFAULT 1,
  INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS lots (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_id INT NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  received DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  expiry DATE NULL,
  batch VARCHAR(40) NOT NULL DEFAULT '',
  status VARCHAR(12) NOT NULL DEFAULT 'sellable',
  ref VARCHAR(60) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  INDEX (item_id, status, expiry)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stock_moves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  at DATETIME NOT NULL,
  item_id INT NOT NULL,
  lot_id INT NOT NULL,
  kind VARCHAR(16) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL DEFAULT 0,
  ref VARCHAR(60) NOT NULL DEFAULT '',
  reason VARCHAR(200) NOT NULL DEFAULT '',
  user_id INT NULL,
  INDEX (item_id, at), INDEX (kind, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15) NULL UNIQUE,
  points DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  INDEX (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS shifts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  counter VARCHAR(20) NOT NULL,
  open_key VARCHAR(20) NULL UNIQUE,          -- = counter while open: one open shift per counter
  cashier_id INT NOT NULL,
  business_date DATE NOT NULL,
  opened_at DATETIME NOT NULL,
  opening_float DECIMAL(12,2) NOT NULL,
  status VARCHAR(6) NOT NULL DEFAULT 'open',
  closed_at DATETIME NULL,
  closed_by INT NULL,
  counted DECIMAL(12,2) NULL,
  expected DECIMAL(12,2) NULL,
  variance DECIMAL(12,2) NULL,
  retained DECIMAL(12,2) NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  INDEX (business_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS cash_moves (
  id INT AUTO_INCREMENT PRIMARY KEY,
  shift_id INT NOT NULL,
  kind VARCHAR(12) NOT NULL,                  -- in / out / deposit
  amount DECIMAL(12,2) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  user_id INT NOT NULL,
  at DATETIME NOT NULL,
  INDEX (shift_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sequences (
  k VARCHAR(60) PRIMARY KEY,
  last INT NOT NULL DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  bill_no VARCHAR(20) NOT NULL UNIQUE,
  client_uuid CHAR(36) NOT NULL UNIQUE,        -- the same bill sent twice is saved once
  business_date DATE NOT NULL,
  created_at DATETIME NOT NULL,
  shift_id INT NOT NULL,
  counter VARCHAR(20) NOT NULL,
  cashier_id INT NOT NULL,
  customer_id INT NULL,
  gross DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  print_count INT NOT NULL DEFAULT 0,
  INDEX (business_date), INDEX (shift_id), INDEX (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  item_id INT NOT NULL,
  sku VARCHAR(20) NOT NULL,
  name VARCHAR(160) NOT NULL,
  name_ta VARCHAR(160) NOT NULL DEFAULT '',
  unit VARCHAR(3) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  list_price DECIMAL(10,2) NOT NULL,
  rate DECIMAL(10,2) NOT NULL,
  mrp DECIMAL(10,2) NULL,
  gross DECIMAL(12,2) NOT NULL,
  discount DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_note VARCHAR(160) NOT NULL DEFAULT '',
  net DECIMAL(12,2) NOT NULL,
  gst_rate DECIMAL(5,2) NOT NULL DEFAULT 0,
  taxable DECIMAL(12,2) NOT NULL,
  cgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  sgst DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  approved_by INT NULL,
  INDEX (sale_id), INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_lot_allocs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  line_id INT NOT NULL,
  lot_id INT NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  unit_cost DECIMAL(12,4) NOT NULL,
  INDEX (line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sale_id INT NOT NULL,
  method VARCHAR(6) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  tendered DECIMAL(12,2) NULL,
  change_amt DECIMAL(12,2) NOT NULL DEFAULT 0,
  reference VARCHAR(60) NOT NULL DEFAULT '',
  INDEX (sale_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit (
  id INT AUTO_INCREMENT PRIMARY KEY,
  at DATETIME NOT NULL,
  user_id INT NULL,
  approver_id INT NULL,
  action VARCHAR(40) NOT NULL,
  summary VARCHAR(300) NOT NULL,
  value DECIMAL(12,2) NOT NULL DEFAULT 0,
  INDEX (at), INDEX (action)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ================================================================== Stage 2
CREATE TABLE IF NOT EXISTS suppliers (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  phone VARCHAR(15) NOT NULL DEFAULT '',
  gstin VARCHAR(15) NOT NULL DEFAULT '',
  address VARCHAR(250) NOT NULL DEFAULT '',
  active TINYINT NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  grn_no VARCHAR(20) NOT NULL UNIQUE,
  supplier_id INT NOT NULL,
  bill_ref VARCHAR(40) NOT NULL DEFAULT '',
  bill_date DATE NULL,
  created_at DATETIME NOT NULL,
  user_id INT NOT NULL,
  total DECIMAL(12,2) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  INDEX (supplier_id), INDEX (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS purchase_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  purchase_id INT NOT NULL,
  item_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  unit VARCHAR(3) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  free_qty DECIMAL(12,3) NOT NULL DEFAULT 0,
  cost DECIMAL(12,4) NOT NULL,                  -- bill rate per piece / kg, GST included
  amount DECIMAL(12,2) NOT NULL,
  expiry DATE NULL,
  batch VARCHAR(40) NOT NULL DEFAULT '',
  lot_id INT NULL,
  INDEX (purchase_id), INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS supplier_payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  supplier_id INT NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(6) NOT NULL,
  reference VARCHAR(60) NOT NULL DEFAULT '',
  at DATETIME NOT NULL,
  user_id INT NOT NULL,
  shift_id INT NULL,
  INDEX (supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_returns (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_no VARCHAR(20) NOT NULL UNIQUE,
  sale_id INT NOT NULL,
  business_date DATE NOT NULL,
  created_at DATETIME NOT NULL,
  user_id INT NOT NULL,
  approver_id INT NULL,
  shift_id INT NULL,
  counter VARCHAR(20) NOT NULL DEFAULT '',
  total DECIMAL(12,2) NOT NULL,
  method VARCHAR(6) NOT NULL,
  reason VARCHAR(200) NOT NULL,
  INDEX (sale_id), INDEX (business_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS return_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  return_id INT NOT NULL,
  sale_line_id INT NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  taxable DECIMAL(12,2) NOT NULL,
  cgst DECIMAL(12,2) NOT NULL,
  sgst DECIMAL(12,2) NOT NULL,
  cost DECIMAL(12,2) NOT NULL DEFAULT 0,
  restock TINYINT NOT NULL DEFAULT 1,
  INDEX (return_id), INDEX (sale_line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  customer_id INT NOT NULL,
  at DATETIME NOT NULL,
  kind VARCHAR(10) NOT NULL,                    -- sale (+ owes) / payment (− paid) / return (−) / adjust
  amount DECIMAL(12,2) NOT NULL,
  ref VARCHAR(60) NOT NULL DEFAULT '',
  method VARCHAR(6) NOT NULL DEFAULT '',
  user_id INT NULL,
  shift_id INT NULL,
  INDEX (customer_id, at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS online_orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  number VARCHAR(12) NOT NULL UNIQUE,
  token CHAR(32) NOT NULL UNIQUE,
  name VARCHAR(80) NOT NULL,
  phone VARCHAR(12) NOT NULL,
  mode VARCHAR(8) NOT NULL,                     -- pickup / delivery
  address VARCHAR(300) NOT NULL DEFAULT '',
  notes VARCHAR(300) NOT NULL DEFAULT '',
  slot DATETIME NOT NULL,
  pay_pref VARCHAR(6) NOT NULL DEFAULT 'cash',
  status VARCHAR(10) NOT NULL DEFAULT 'new',    -- new / accepted / ready / out / done / cancelled
  status_note VARCHAR(200) NOT NULL DEFAULT '',
  est_items DECIMAL(12,2) NOT NULL,
  delivery_charge DECIMAL(10,2) NOT NULL DEFAULT 0,
  sale_id INT NULL,
  ip VARCHAR(45) NOT NULL DEFAULT '',
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX (status, slot), INDEX (phone)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS online_order_lines (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  item_id INT NOT NULL,
  name VARCHAR(160) NOT NULL,
  name_ta VARCHAR(160) NOT NULL DEFAULT '',
  unit VARCHAR(3) NOT NULL,
  qty DECIMAL(12,3) NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  INDEX (order_id), INDEX (item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS stored_backups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(80) NOT NULL UNIQUE,
  created_at DATETIME NOT NULL,
  bytes INT NOT NULL,
  kind VARCHAR(8) NOT NULL DEFAULT 'daily'
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- customers' online accounts
CREATE TABLE IF NOT EXISTS customer_sessions (
  id CHAR(64) PRIMARY KEY,
  customer_id INT NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  INDEX (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS otps (
  id INT AUTO_INCREMENT PRIMARY KEY,
  phone VARCHAR(12) NOT NULL,
  purpose VARCHAR(10) NOT NULL,
  code_hash CHAR(64) NOT NULL,
  created_at DATETIME NOT NULL,
  expires_at DATETIME NOT NULL,
  tries INT NOT NULL DEFAULT 0,
  used TINYINT NOT NULL DEFAULT 0,
  ip VARCHAR(45) NOT NULL DEFAULT '',
  INDEX (phone, created_at), INDEX (ip, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- shop expenses (rent, power, salary, tea …)
CREATE TABLE IF NOT EXISTS expenses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  business_date DATE NOT NULL,
  at DATETIME NOT NULL,
  category VARCHAR(40) NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  method VARCHAR(6) NOT NULL,
  note VARCHAR(200) NOT NULL DEFAULT '',
  user_id INT NOT NULL,
  shift_id INT NULL,
  INDEX (business_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
