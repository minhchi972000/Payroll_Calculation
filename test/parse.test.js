import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPeriod, normalizeCccd, normalizeLoginId, parsePayrollTable } from '../src/parse.js';

test('chuẩn hoá CCCD', () => {
  assert.equal(normalizeCccd('079300001234'), '079300001234');
  assert.equal(normalizeCccd('079 300 001 234'), '079300001234');
  assert.equal(normalizeCccd(79300001234), '079300001234'); // Excel làm mất số 0
  assert.equal(normalizeCccd(1300000001), '001300000001'); // mã tỉnh 001 mất 2 số 0
  assert.equal(normalizeCccd('0901234567'), null); // SĐT nhập nhầm vào cột CCCD
  assert.equal(normalizeCccd('123456789'), null); // CMND 9 số cũ
  assert.equal(normalizeCccd('179300001234'), null);
  assert.equal(normalizeCccd(''), null);
});

test('đăng nhập chỉ bằng CCCD đủ 12 số', () => {
  assert.equal(normalizeLoginId(' 079300001234 '), '079300001234');
  assert.equal(normalizeLoginId('079 300 001 234'), '079300001234');
  assert.equal(normalizeLoginId('79300001234'), null); // thiếu số, không tự thêm 0 khi đăng nhập
  assert.equal(normalizeLoginId('0901234567'), null); // SĐT không dùng được
  assert.equal(normalizeLoginId('999999999999'), null); // không phải CCCD (mã tỉnh 999)
  assert.equal(normalizeLoginId(undefined), null);
});

test('kỳ lương', () => {
  assert.ok(isValidPeriod('2026-10'));
  assert.ok(!isValidPeriod('2026-13'));
  assert.ok(!isValidPeriod('2026-1'));
  assert.ok(!isValidPeriod(undefined));
});

test('bảng đơn giản có dòng tiêu đề trang, STT, cột ẩn, dòng tổng', () => {
  const rows = [
    ['BẢNG LƯƠNG THÁNG 10/2026', '', '', '', '', ''],
    [],
    ['STT', 'Họ và tên', 'Số CCCD', 'Lương cơ bản', '#Ghi chú nội bộ', 'Thực lĩnh'],
    [1, 'Nguyễn Văn A', 79300001234, 10000000, 'tăng lương T11', 9500000],
    [2, 'Trần Thị B', '036 095 004 567', 12000000, '', 11300000],
    ['', 'Tổng cộng', '', 22000000, '', 20800000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.errors, []);
  assert.equal(out.idLabel, 'Số CCCD');
  assert.deepEqual(out.columns, ['Lương cơ bản', 'Thực lĩnh']);
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], { loginId: '079300001234', name: 'Nguyễn Văn A', values: [10000000, 9500000] });
  assert.equal(out.records[1].loginId, '036095004567');
  assert.deepEqual(out.warnings, []); // dòng "Tổng cộng" bỏ qua mà không báo
});

test('tiêu đề 2 tầng (ô gộp đã được điền)', () => {
  const rows = [
    ['Họ tên', 'CCCD', 'Lương', 'Khấu trừ', 'Khấu trừ', 'Thực nhận'],
    ['Họ tên', 'CCCD', 'Lương', 'BHXH', 'Thuế TNCN', 'Thực nhận'],
    ['Lê C', '001301007890', 15000000, 1200000, 300000, 13500000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.columns, ['Lương', 'Khấu trừ - BHXH', 'Khấu trừ - Thuế TNCN', 'Thực nhận']);
  assert.deepEqual(out.records[0].values, [15000000, 1200000, 300000, 13500000]);
});

test('dòng tên phòng ban gộp ô không bị nhầm là tiêu đề phụ', () => {
  const rows = [
    ['Họ tên', 'Số CCCD', 'Lương'],
    ['Phòng Kinh doanh', 'Phòng Kinh doanh', 'Phòng Kinh doanh'],
    ['Lê C', '001301007890', 15000000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.columns, ['Lương']);
  assert.equal(out.records.length, 1);
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings[0], /Dòng 2: không có Số CCCD/);
});

test('báo lỗi CCCD sai và trùng', () => {
  const rows = [
    ['Họ tên', 'Số CCCD', 'Lương'],
    ['A', '079300001234', 1],
    ['B', '07930', 2],
    ['C', '079 300 001 234', 3],
  ];
  const out = parsePayrollTable(rows);
  assert.equal(out.records.length, 1);
  assert.equal(out.errors.length, 2);
  assert.match(out.errors[0], /Dòng 3.*không hợp lệ/);
  assert.match(out.errors[1], /Dòng 4.*trùng với dòng 2/);
});

test('không có cột CCCD', () => {
  const out = parsePayrollTable([['Họ tên', 'Lương'], ['A', 1]]);
  assert.equal(out.records.length, 0);
  assert.match(out.errors[0], /Không tìm thấy cột số CCCD/);
});

test('file chỉ có cột SĐT bị từ chối (đăng nhập chỉ bằng CCCD)', () => {
  const out = parsePayrollTable([['Họ tên', 'SĐT', 'Lương'], ['A', '0901234567', 1]]);
  assert.equal(out.records.length, 0);
  assert.match(out.errors[0], /Không tìm thấy cột số CCCD/);
});

// Giống bảng lương thật của công ty: đăng nhập bằng CCCD, tiêu đề 2 tầng có chữ Trung,
// cột STT hẹp bị xuống dòng thành "ST T", các ô gộp dọc đã được điền xuống dòng dưới.
test('mẫu bảng lương có cột Số CCCD', () => {
  const top = ['ST\nT', 'HỌ &TÊN', 'SỐ CCCD', 'CHỨC VỤ', 'LƯƠNG CƠ BẢN', 'NGÀY CÔNG 天数', 'NGÀY CÔNG 天数', 'NGÀY CÔNG 天数',
    'NGHỈ PHÉP 休假', 'NGHỈ PHÉP 休假', '', 'KHÁC 其他 thuong le-Tet', 'TRỪ TIỀN TẠM ỨNG - LÀM THIẾU GIỜ', 'THỰC LÃNH'];
  const sub = ['ST\nT', 'HỌ &TÊN', 'SỐ CCCD', 'CHỨC VỤ', 'LƯƠNG CƠ BẢN', 'ĐÊM', 'NGÀY', 'TC',
    'XIN PHÉP', 'PHÉP NĂM', 'GIỜ TC NGÀY', 'KHÁC 其他 thuong le-Tet', 'TRỪ TIỀN TẠM ỨNG - LÀM THIẾU GIỜ', 'THỰC LÃNH'];
  const rows = [
    ['CÔNG TY TNHH ABC'],
    ['BẢNG LƯƠNG THÁNG 10/2026'],
    top,
    sub,
    [29, 'NGUYỄN THỊ\nHOA', '079300001234', 'KT', 5310000, 0, 26, 0, 0, 1, 12.5, '', 0, 6481500],
    [30, 'TRẦN VĂN B', 1300000001, 'CN', 4960000, 8, 18, 2, 1, 0, 20, 500000, 200000, 7120000],
    ['', 'TỔNG CỘNG', '', '', 10270000, 8, 44, 2, 1, 1, 32.5, 500000, 200000, 13601500],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.errors, []);
  assert.equal(out.idLabel, 'Số CCCD');
  assert.deepEqual(out.columns, [
    'CHỨC VỤ', 'LƯƠNG CƠ BẢN', 'NGÀY CÔNG 天数 - ĐÊM', 'NGÀY CÔNG 天数 - NGÀY', 'NGÀY CÔNG 天数 - TC',
    'NGHỈ PHÉP 休假 - XIN PHÉP', 'NGHỈ PHÉP 休假 - PHÉP NĂM', 'GIỜ TC NGÀY', 'KHÁC 其他 thuong le-Tet',
    'TRỪ TIỀN TẠM ỨNG - LÀM THIẾU GIỜ', 'THỰC LÃNH',
  ]);
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], {
    loginId: '079300001234',
    name: 'NGUYỄN THỊ HOA',
    values: ['KT', 5310000, 0, 26, 0, 0, 1, 12.5, '', 0, 6481500],
  });
  assert.equal(out.records[1].loginId, '001300000001');
  assert.deepEqual(out.warnings, []); // dòng TỔNG CỘNG bỏ qua mà không báo
});

test('cột SĐT nằm cạnh cột CCCD hiện như cột bình thường', () => {
  const rows = [
    ['Họ tên', 'SĐT', 'Số CCCD', 'Lương'],
    ['A', '0901234567', '079300001234', 1],
  ];
  const out = parsePayrollTable(rows);
  assert.equal(out.idLabel, 'Số CCCD');
  assert.deepEqual(out.columns, ['SĐT', 'Lương']);
  assert.equal(out.records[0].loginId, '079300001234');
});

test('CCCD sai độ dài báo lỗi rõ ràng', () => {
  const out = parsePayrollTable([['Họ tên', 'Số CCCD', 'Lương'], ['A', '123456789', 1]]);
  assert.match(out.errors[0], /Dòng 2: Số CCCD "123456789" không hợp lệ \(cần đủ 12 chữ số\)/);
});
