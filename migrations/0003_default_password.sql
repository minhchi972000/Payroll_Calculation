-- Nhân viên không tự đổi mật khẩu nữa, chỉ admin đổi. Cột này giờ cho biết tài khoản
-- đang dùng mật khẩu mặc định (6 số cuối CCCD, 1) hay mật khẩu admin đặt (0).
ALTER TABLE employees RENAME COLUMN must_change_password TO default_password;
