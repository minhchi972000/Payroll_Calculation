-- Nhân viên: đăng nhập bằng SĐT (dạng 0xxxxxxxxx)
CREATE TABLE employees (
  phone TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  must_change_password INTEGER NOT NULL DEFAULT 1,
  last_login_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Mỗi kỳ lương (YYYY-MM) lưu danh sách cột theo đúng thứ tự trong file
CREATE TABLE periods (
  period TEXT PRIMARY KEY,
  columns TEXT NOT NULL,
  source TEXT NOT NULL,
  imported_at INTEGER NOT NULL
);

-- Một dòng lương của một người trong một kỳ; values khớp thứ tự với periods.columns
CREATE TABLE payslips (
  period TEXT NOT NULL REFERENCES periods(period) ON DELETE CASCADE,
  phone TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  "values" TEXT NOT NULL,
  PRIMARY KEY (period, phone)
);
CREATE INDEX payslips_phone ON payslips(phone);

-- Chỉ lưu SHA-256 của token, không lưu token gốc
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('employee', 'admin')),
  subject TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_subject ON sessions(kind, subject);

CREATE TABLE rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  reset_at INTEGER NOT NULL
);
