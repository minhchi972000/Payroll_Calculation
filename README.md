# Bảng lương: mỗi người chỉ xem lương của mình

Admin nhập một bảng lương chung (Excel hoặc Google Sheet). Mọi nhân viên dùng chung một link,
đăng nhập bằng số CCCD (đủ 12 số) và chỉ thấy phiếu lương của chính mình.

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

# 5. Đặt tài khoản và mật khẩu admin (mật khẩu nên dài từ 12 ký tự). Lệnh sẽ hỏi giá trị, không ghi vào code
npx wrangler secret put ADMIN_USERNAME
npx wrangler secret put ADMIN_PASSWORD
```

Xong. Link gửi cho nhân viên là địa chỉ gốc. Admin đăng nhập ngay ở trang đó bằng tài khoản admin (gõ vào ô Số CCCD)
và được chuyển sang trang quản lý; hoặc vào thẳng `https://bang-luong.<ten-ban>.workers.dev/admin`.
Để gõ được ở ô Số CCCD, `ADMIN_USERNAME` nên là 12 chữ số và không trùng CCCD của ai (ví dụ bắt đầu bằng 9).
Muốn dùng tên miền riêng (ví dụ `luong.congty.vn`): Cloudflare dashboard → Workers → bang-luong → Settings → Domains & Routes.

## Quy trình hằng tháng

1. Vào `/admin` → **Nhập bảng lương** → chọn tháng → chọn file Excel (hoặc dán link Google Sheet).
2. Bấm **Kiểm tra dữ liệu**: xem số người, các cột nhân viên sẽ thấy, các dòng lỗi.
3. Bấm **Xác nhận nhập**. Nhân viên xem được ngay.
4. Nếu có nhân viên mới, hệ thống tạo **mã 8 số** cho từng người. Bấm **Sao chép tin nhắn** rồi gửi qua Zalo,
   hoặc **Tải danh sách mã (CSV)**. Mã chỉ hiện một lần.

Nhân viên đăng nhập lần đầu bằng số CCCD + mã 8 số, sau đó tự đặt mật khẩu riêng.
Quên mật khẩu: admin vào tab **Nhân viên** → **Cấp mã mới**.

Nhập lại cùng một tháng sẽ **thay thế** toàn bộ dữ liệu cũ của tháng đó (dùng khi sửa sai).

## Định dạng bảng lương

**File mẫu để điền hằng tháng:** [public/mau-bang-luong.xlsx](public/mau-bang-luong.xlsx), cũng tải được ở trang admin
(link "Tải file mẫu" trong tab Nhập bảng lương). File có sẵn 35 cột, 200 dòng kẻ sẵn, dòng tổng cộng, ô CCCD giữ số 0 đầu,
tự tô đỏ CCCD trùng, và sheet "Hướng dẫn" có dòng ví dụ. Dùng Google Sheet thì tải file này lên Google Drive rồi mở bằng
Google Trang tính.

Ví dụ đã điền sẵn 3 người (dữ liệu giả, để chạy thử): [mau/bang-luong-mau.xlsx](mau/bang-luong-mau.xlsx)

- Cần một dòng tiêu đề có cột **Số CCCD** (hoặc "CCCD", "Số căn cước", "Số CMND") và **Họ tên** (hoặc "Họ & tên", "Họ và tên").
  Nhân viên đăng nhập bằng số trong cột này.
  Dòng tiêu đề không cần nằm ở dòng 1, phía trên có thể có tên công ty, tiêu đề bảng.
- Cột CCCD là bắt buộc. Cột SĐT (nếu có) chỉ hiện như một cột bình thường, không dùng để đăng nhập.
- **Mọi cột còn lại sẽ hiện cho nhân viên**, đúng thứ tự trong file.
- Cột bị ẩn: "STT" (kể cả khi bị xuống dòng thành "ST T"), và cột có tiêu đề bắt đầu bằng **#** (ví dụ `#Ghi chú nội bộ`).
- Tiêu đề 2 tầng gộp ô (ví dụ "Khấu trừ" nằm trên "BHXH", "Thuế TNCN") sẽ hiện thành "Khấu trừ - BHXH".
- Dòng không có CCCD (dòng tổng cộng, tên phòng ban, chữ ký) được bỏ qua.
- CCCD phải đủ 12 số. Ô kiểu số trong Excel làm mất số 0 đầu (ví dụ `79300001234`, hay `1301007890` với mã tỉnh 001)
  vẫn đọc đúng. CMND cũ 9 số không được chấp nhận.
- Cột có chữ "Thực lĩnh" / "Thực nhận" / "Thực lãnh" được làm nổi bật ở đầu phiếu lương.

## Bản prod và bản demo

| | Địa chỉ | Database | Deploy |
|---|---|---|---|
| Prod (dữ liệu thật) | https://bang-luong.bang-luong.workers.dev | `bang-luong` | `npm run deploy` |
| Demo (dữ liệu giả) | https://bang-luong-demo.bang-luong.workers.dev | `bang-luong-demo` | `npm run deploy:demo` |

Hai bản dùng chung code nhưng database và tài khoản admin riêng. Bản demo có dải "BẢN DEMO" ở đầu trang
(hiện khi địa chỉ web có chữ "demo"). Demo đã nạp sẵn file [mau/bang-luong-mau.xlsx](mau/bang-luong-mau.xlsx)
cho tháng 10/2026; 3 nhân viên giả đăng nhập bằng số CCCD trong file (ví dụ `036095004567`) và mật khẩu `demo123`.

Đổi code thì deploy cả hai. Có migration mới thì chạy cho cả hai database:

```bash
npm run db:migrate:remote && npm run deploy          # prod
npm run db:migrate:demo && npm run deploy:demo       # demo
```

Tài khoản admin của demo đặt riêng: `npx wrangler secret put ADMIN_USERNAME --env demo` (tương tự với `ADMIN_PASSWORD`).

## Nâng cấp bản đã triển khai

Khi có file mới trong `migrations/`, chạy lại trước khi deploy:

```bash
npm run db:migrate:remote
npm run deploy
```

Tài khoản và phiếu lương cũ được giữ nguyên.

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
cp .dev.vars.example .dev.vars      # sửa ADMIN_USERNAME, ADMIN_PASSWORD nếu muốn
npm run db:migrate:local
npm run dev                         # mở http://localhost:8787 và http://localhost:8787/admin
npm test
```

## Bảo mật

- Phiếu lương luôn được lọc theo số CCCD trong phiên đăng nhập ở server, không theo tham số từ trình duyệt.
- Mật khẩu nhân viên được băm (PBKDF2). Phiên đăng nhập là cookie HttpOnly, chỉ lưu bản băm trong database.
- Sai 5 lần với cùng một tài khoản thì khoá 15 phút. Admin bấm "Cấp mã mới" sẽ mở khoá ngay.
- Đổi mật khẩu hoặc cấp mã mới sẽ đăng xuất người đó khỏi mọi thiết bị khác.
- Admin đăng nhập bằng một tài khoản chung (`ADMIN_USERNAME` + `ADMIN_PASSWORD`), phiên admin hết hạn sau 8 giờ.
  Sai 5 lần từ cùng một máy thì khoá 15 phút.
  Đổi tài khoản hoặc mật khẩu admin: chạy lại `npx wrangler secret put ADMIN_USERNAME` / `ADMIN_PASSWORD`.

## Giới hạn gói miễn phí của Cloudflare

100.000 request/ngày, database 5 GB. Công ty vài trăm người dùng không chạm tới giới hạn này.
