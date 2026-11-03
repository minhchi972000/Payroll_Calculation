import assert from 'node:assert/strict';
import test from 'node:test';
import { isValidPeriod, normalizePhone, parsePayrollTable } from '../src/parse.js';

test('chuẩn hoá SĐT', () => {
  assert.equal(normalizePhone('0901 234 567'), '0901234567');
  assert.equal(normalizePhone('+84 901.234.567'), '0901234567');
  assert.equal(normalizePhone(901234567), '0901234567'); // Excel làm mất số 0
  assert.equal(normalizePhone('84901234567'), '0901234567');
  assert.equal(normalizePhone('12345'), null);
  assert.equal(normalizePhone(''), null);
  assert.equal(normalizePhone(null), null);
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
    ['STT', 'Họ và tên', 'SĐT', 'Lương cơ bản', '#Ghi chú nội bộ', 'Thực lĩnh'],
    [1, 'Nguyễn Văn A', 901234567, 10000000, 'tăng lương T11', 9500000],
    [2, 'Trần Thị B', '0912 345 678', 12000000, '', 11300000],
    ['', 'Tổng cộng', '', 22000000, '', 20800000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.columns, ['Lương cơ bản', 'Thực lĩnh']);
  assert.equal(out.records.length, 2);
  assert.deepEqual(out.records[0], { phone: '0901234567', name: 'Nguyễn Văn A', values: [10000000, 9500000] });
  assert.equal(out.records[1].phone, '0912345678');
  assert.equal(out.warnings.length, 1);
  assert.match(out.warnings[0], /Dòng 6/);
});

test('tiêu đề 2 tầng (ô gộp đã được điền)', () => {
  const rows = [
    ['Họ tên', 'Số điện thoại', 'Lương', 'Khấu trừ', 'Khấu trừ', 'Thực nhận'],
    ['Họ tên', 'Số điện thoại', 'Lương', 'BHXH', 'Thuế TNCN', 'Thực nhận'],
    ['Lê C', '0987654321', 15000000, 1200000, 300000, 13500000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.errors, []);
  assert.deepEqual(out.columns, ['Lương', 'Khấu trừ - BHXH', 'Khấu trừ - Thuế TNCN', 'Thực nhận']);
  assert.deepEqual(out.records[0].values, [15000000, 1200000, 300000, 13500000]);
});

test('dòng tên phòng ban gộp ô không bị nhầm là tiêu đề phụ', () => {
  const rows = [
    ['Họ tên', 'SĐT', 'Lương'],
    ['Phòng Kinh doanh', 'Phòng Kinh doanh', 'Phòng Kinh doanh'],
    ['Lê C', '0987654321', 15000000],
  ];
  const out = parsePayrollTable(rows);
  assert.deepEqual(out.columns, ['Lương']);
  assert.equal(out.records.length, 1);
  assert.deepEqual(out.errors, []);
  assert.match(out.warnings[0], /Dòng 2: không có SĐT/);
});

test('báo lỗi SĐT sai và trùng', () => {
  const rows = [
    ['Họ tên', 'SĐT', 'Lương'],
    ['A', '0901234567', 1],
    ['B', '090123', 2],
    ['C', '0901 234 567', 3],
  ];
  const out = parsePayrollTable(rows);
  assert.equal(out.records.length, 1);
  assert.equal(out.errors.length, 2);
  assert.match(out.errors[0], /Dòng 3.*không hợp lệ/);
  assert.match(out.errors[1], /Dòng 4.*trùng với dòng 2/);
});

test('không có cột SĐT', () => {
  const out = parsePayrollTable([['Họ tên', 'Lương'], ['A', 1]]);
  assert.equal(out.records.length, 0);
  assert.match(out.errors[0], /Không tìm thấy cột số điện thoại/);
});
