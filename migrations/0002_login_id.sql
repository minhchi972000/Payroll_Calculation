-- Nhân viên đăng nhập bằng số CCCD (12 số) hoặc SĐT (10 số), nên cột "phone" đổi thành "login_id".
-- Tài khoản và phiên đăng nhập cũ vẫn dùng được: login_id của họ chính là SĐT cũ.
ALTER TABLE employees RENAME COLUMN phone TO login_id;
ALTER TABLE payslips RENAME COLUMN phone TO login_id;
DROP INDEX payslips_phone;
CREATE INDEX payslips_login_id ON payslips(login_id);

-- Khoá đăng nhập sai giờ dùng khoá "id:..." thay cho "phone:..."
DELETE FROM rate_limits WHERE key LIKE 'phone:%';
