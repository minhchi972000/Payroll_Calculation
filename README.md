# Bảng lương: mỗi người chỉ xem lương của mình

Admin nhập một bảng lương chung (Excel hoặc Google Sheet). Mọi nhân viên dùng chung một link,
đăng nhập bằng số điện thoại và chỉ thấy phiếu lương của chính mình.

- Chạy trên **Cloudflare Workers + D1**, gói miễn phí (cho phép dùng cho công ty).
- Server chỉ trả về dòng lương của người đang đăng nhập. Trình duyệt không bao giờ nhận được dữ liệu của người khác.

## Triển khai lần đầu (khoảng 10 phút)

Cần: Node.js 20 trở lên và một tài khoản Cloudflare miễn phí (https://dash.cloudflare.com/sign-up).

```bash
cd bang-luong
npm install

# 1. Đăng nhập Cloudflare (mở trình duyệt)
npx wrangler login

# 2. Tạo database, rồi copy "database_id" in ra vào wrangler.jsonc (thay dãy 0000...)
npx wrangler d1 create bang-luong

# 3. Tạo bảng trong database
npm run db:migrate:remote

# 4. Đưa web lên. Lệnh này in ra link dạng https://bang-luong.<ten-ban>.workers.dev
npm run deploy

# 5. Đặt mật khẩu admin (nên dài từ 12 ký tự)
npx wrangler secret put ADMIN_PASSWORD
```

Xong. Trang admin ở `https://bang-luong.<ten-ban>.workers.dev/admin`, link gửi cho nhân viên là địa chỉ gốc.
Muốn dùng tên miền riêng (ví dụ `luong.congty.vn`): Cloudflare dashboard → Workers → bang-luong → Settings → Domains & Routes.

## Quy trình hằng tháng

1. Vào `/admin` → **Nhập bảng lương** → chọn tháng → chọn file Excel (hoặc dán link Google Sheet).
2. Bấm **Kiểm tra dữ liệu**: xem số người, các cột nhân viên sẽ thấy, các dòng lỗi.
3. Bấm **Xác nhận nhập**. Nhân viên xem được ngay.
4. Nếu có nhân viên mới, hệ thống tạo **mã 8 số** cho từng người. Bấm **Sao chép tin nhắn** rồi gửi qua Zalo,
   hoặc **Tải danh sách mã (CSV)**. Mã chỉ hiện một lần.

Nhân viên đăng nhập lần đầu bằng SĐT + mã 8 số, sau đó tự đặt mật khẩu riêng.
Quên mật khẩu: admin vào tab **Nhân viên** → **Cấp mã mới**.

Nhập lại cùng một tháng sẽ **thay thế** toàn bộ dữ liệu cũ của tháng đó (dùng khi sửa sai).

## Định dạng bảng lương

Xem file mẫu: [mau/bang-luong-mau.xlsx](mau/bang-luong-mau.xlsx)

- Cần một dòng tiêu đề có cột **SĐT** (hoặc "Số điện thoại", "Điện thoại") và **Họ tên** (hoặc "Họ và tên").
  Dòng tiêu đề không cần nằm ở dòng 1, phía trên có thể có tên công ty, tiêu đề bảng.
- **Mọi cột còn lại sẽ hiện cho nhân viên**, đúng thứ tự trong file.
- Cột bị ẩn: "STT", và cột có tiêu đề bắt đầu bằng **#** (ví dụ `#Ghi chú nội bộ`).
- Tiêu đề 2 tầng gộp ô (ví dụ "Khấu trừ" nằm trên "BHXH", "Thuế TNCN") sẽ hiện thành "Khấu trừ - BHXH".
- Dòng không có SĐT (dòng tổng cộng, tên phòng ban) được bỏ qua.
- SĐT có thể ghi `0901234567`, `0901 234 567`, `+84901234567`. Ô kiểu số bị mất số 0 đầu vẫn đọc đúng.
- Cột có chữ "Thực lĩnh" / "Thực nhận" / "Thực lãnh" được làm nổi bật ở đầu phiếu lương.

## Dùng Google Sheet (tuỳ chọn)

Sheet vẫn để **riêng tư**, chỉ share cho một "tài khoản máy" (service account) của web.

1. Vào https://console.cloud.google.com → tạo project mới (tên tuỳ ý).
2. **APIs & Services → Library** → tìm "Google Sheets API" → **Enable**.
3. **IAM & Admin → Service Accounts → Create service account** (không cần cấp role nào).
4. Mở service account vừa tạo → **Keys → Add key → Create new key → JSON** → tải file về.
5. Đưa file đó vào web, rồi xoá file trên máy:
   ```bash
   npx wrangler secret put GOOGLE_SERVICE_ACCOUNT_JSON < duong-dan/file-key.json
   ```
6. Mở Google Sheet bảng lương → **Chia sẻ** → thêm email service account (dạng `...@....iam.gserviceaccount.com`),
   quyền **Người xem**. Trang admin cũng hiện email này.
7. Trong admin chọn **Google Sheet**, mở đúng tab cần nhập rồi dán link (link có `#gid=` sẽ lấy đúng tab đó).

Không muốn cấu hình? Trong Google Sheet chọn **Tệp → Tải xuống → .xlsx** rồi nhập như file Excel.

## Chạy thử trên máy

```bash
cp .dev.vars.example .dev.vars      # sửa ADMIN_PASSWORD nếu muốn
npm run db:migrate:local
npm run dev                         # mở http://localhost:8787 và http://localhost:8787/admin
npm test
```

## Bảo mật

- Phiếu lương luôn được lọc theo SĐT trong phiên đăng nhập ở server, không theo tham số từ trình duyệt.
- Mật khẩu nhân viên được băm (PBKDF2). Phiên đăng nhập là cookie HttpOnly, chỉ lưu bản băm trong database.
- Sai 5 lần với cùng một SĐT thì khoá 15 phút. Admin bấm "Cấp mã mới" sẽ mở khoá ngay.
- Đổi mật khẩu hoặc cấp mã mới sẽ đăng xuất người đó khỏi mọi thiết bị khác.
- Admin dùng một mật khẩu chung (`ADMIN_PASSWORD`), phiên admin hết hạn sau 8 giờ.
  Đổi mật khẩu admin: chạy lại `npx wrangler secret put ADMIN_PASSWORD`.

## Giới hạn gói miễn phí của Cloudflare

100.000 request/ngày, database 5 GB. Công ty vài trăm người dùng không chạm tới giới hạn này.
