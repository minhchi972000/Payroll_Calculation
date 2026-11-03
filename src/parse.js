// Đọc bảng lương dạng mảng 2 chiều (từ Excel hoặc Google Sheet) thành dữ liệu từng người.

const PHONE_HEADERS = ['sdt', 'so dt', 'so dien thoai', 'dien thoai', 'dien thoai di dong', 'phone', 'mobile', 'so dien thoai lien he'];
const CCCD_HEADERS = [
  'so cccd', 'cccd', 'so can cuoc', 'can cuoc', 'so can cuoc cong dan', 'can cuoc cong dan',
  'so cccd cmnd', 'cccd cmnd', 'so cmnd cccd', 'cmnd cccd', 'so cmnd', 'cmnd',
];
const NAME_HEADERS = ['ho ten', 'ho va ten', 'ten', 'ten nhan vien', 'ho ten nhan vien', 'ho va ten nhan vien', 'nhan vien', 'name', 'full name'];
// So sánh sau khi bỏ khoảng trắng, vì tiêu đề hẹp hay bị xuống dòng thành "ST T"
const SKIPPED_HEADERS = ['stt', 'tt'];
const HEADER_SCAN_ROWS = 20;

export function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Trả về SĐT dạng 0xxxxxxxxx, hoặc null nếu không hợp lệ.
// Excel hay làm mất số 0 đầu (ô kiểu số), nên 912345678 vẫn được chấp nhận.
export function normalizePhone(value) {
  if (value === null || value === undefined) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.startsWith('84') && digits.length === 11) digits = '0' + digits.slice(2);
  if (digits.length === 9 && !digits.startsWith('0')) digits = '0' + digits;
  return /^0\d{9}$/.test(digits) ? digits : null;
}

// Trả về số CCCD 12 chữ số, hoặc null nếu không hợp lệ.
// CCCD mở đầu bằng mã tỉnh 001–096. Ô kiểu số trong Excel làm mất các số 0 đầu
// (mất 2 số với mã 001–009), nên 10–11 chữ số vẫn được chấp nhận và thêm lại số 0.
export function normalizeCccd(value) {
  if (value === null || value === undefined) return null;
  let digits = String(value).replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) digits = digits.padStart(12, '0');
  return /^0(?!00)\d{11}$/.test(digits) ? digits : null;
}

// Tên đăng nhập nhân viên gõ vào: 12 chữ số là CCCD, còn lại coi là SĐT.
export function normalizeLoginId(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length === 12 ? normalizeCccd(digits) : normalizePhone(value);
}

// Cột dùng làm tên đăng nhập. File có cả hai cột thì dùng CCCD.
const ID_COLUMNS = [
  { headers: CCCD_HEADERS, label: 'Số CCCD', hint: 'cần đủ 12 chữ số', normalize: normalizeCccd },
  { headers: PHONE_HEADERS, label: 'SĐT', hint: 'cần đủ 10 chữ số', normalize: normalizePhone },
];

export function isValidPeriod(period) {
  return typeof period === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(period);
}

function cleanCell(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? value : '';
  if (typeof value === 'boolean') return value ? 'Có' : 'Không';
  return String(value).replace(/\s+/g, ' ').trim();
}

function isEmptyRow(row) {
  return !row || row.every((cell) => cleanCell(cell) === '');
}

function findHeaderRow(rows) {
  const limit = Math.min(rows.length, HEADER_SCAN_ROWS);
  for (let i = 0; i < limit; i++) {
    const row = rows[i] || [];
    for (const id of ID_COLUMNS) {
      const idCol = row.findIndex((cell) => id.headers.includes(normalizeText(cell)));
      if (idCol !== -1) return { index: i, idCol, id };
    }
  }
  return null;
}

// Dòng ngay dưới tiêu đề là tiêu đề phụ nếu: không có số, không có CCCD/SĐT hợp lệ, và có ít nhất
// 2 chữ khác nhau không trùng với ô phía trên (dòng tên phòng ban gộp ô chỉ có 1 giá trị).
function hasSubHeader(rows, header) {
  const next = rows[header.index + 1];
  if (!next || header.id.normalize(next[header.idCol])) return false;
  if (next.some((cell) => typeof cleanCell(cell) === 'number')) return false;
  const top = rows[header.index];
  const distinct = new Set();
  next.forEach((cell, i) => {
    const value = cleanCell(cell);
    if (value !== '' && value !== cleanCell(top[i])) distinct.add(value);
  });
  return distinct.size >= 2;
}

/**
 * Ô gộp phải được điền giá trị vào mọi ô con trước khi gọi hàm này.
 * @param {unknown[][]} rows  Bảng thô, dòng đầu tiên có thể là tiêu đề trang.
 * @returns {{ idLabel: string, columns: string[], records: {loginId: string, name: string, values: (string|number)[]}[],
 *             errors: string[], warnings: string[] }}
 */
export function parsePayrollTable(rows) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(rows) || rows.length === 0) {
    return { idLabel: '', columns: [], records: [], errors: ['File không có dữ liệu.'], warnings };
  }

  const header = findHeaderRow(rows);
  if (!header) {
    return {
      idLabel: '',
      columns: [],
      records: [],
      errors: [`Không tìm thấy cột số CCCD hoặc số điện thoại trong ${HEADER_SCAN_ROWS} dòng đầu. Hãy đặt tiêu đề cột là "Số CCCD" (hoặc "SĐT").`],
      warnings,
    };
  }

  const headerRow = rows[header.index];
  const subRow = hasSubHeader(rows, header) ? rows[header.index + 1] : null;
  const width = Math.max(headerRow.length, subRow ? subRow.length : 0);
  const parts = Array.from({ length: width }, (_, i) => {
    const top = String(cleanCell(headerRow[i]));
    const sub = subRow ? String(cleanCell(subRow[i])) : '';
    return { top, sub, label: sub === '' || sub === top ? top : top === '' ? sub : `${top} - ${sub}` };
  });

  const nameCol = parts.findIndex(
    (p, i) => i !== header.idCol && (NAME_HEADERS.includes(normalizeText(p.top)) || NAME_HEADERS.includes(normalizeText(p.label))),
  );
  if (nameCol === -1) warnings.push('Không thấy cột "Họ tên", phiếu lương sẽ không hiện tên.');

  // Các cột còn lại được hiển thị cho nhân viên. Cột bắt đầu bằng "#" là cột nội bộ, bị ẩn.
  const visible = [];
  parts.forEach((p, i) => {
    if (i === header.idCol || i === nameCol || p.label === '') return;
    if (p.top.startsWith('#') || p.sub.startsWith('#')) return;
    if (SKIPPED_HEADERS.includes(normalizeText(p.label).replace(/ /g, ''))) return;
    visible.push({ index: i, label: p.label });
  });
  if (visible.length === 0) errors.push('Không có cột lương nào để hiển thị.');

  const { label: idLabel, hint } = header.id;
  const records = [];
  const seen = new Map();
  for (let r = header.index + (subRow ? 2 : 1); r < rows.length; r++) {
    const row = rows[r] || [];
    if (isEmptyRow(row)) continue;
    const excelRow = r + 1;
    const rawId = cleanCell(row[header.idCol]);
    if (!/\d/.test(String(rawId))) {
      warnings.push(`Dòng ${excelRow}: không có ${idLabel}, đã bỏ qua (thường là dòng tổng cộng hoặc tên phòng ban).`);
      continue;
    }
    const loginId = header.id.normalize(rawId);
    if (!loginId) {
      errors.push(`Dòng ${excelRow}: ${idLabel} "${rawId}" không hợp lệ (${hint}).`);
      continue;
    }
    if (seen.has(loginId)) {
      errors.push(`Dòng ${excelRow}: ${idLabel} ${loginId} bị trùng với dòng ${seen.get(loginId)}.`);
      continue;
    }
    seen.set(loginId, excelRow);
    records.push({
      loginId,
      name: nameCol === -1 ? '' : String(cleanCell(row[nameCol])),
      values: visible.map((col) => cleanCell(row[col.index])),
    });
  }

  if (records.length === 0 && errors.length === 0) errors.push(`Không có dòng nhân viên nào có ${idLabel}.`);
  return { idLabel, columns: visible.map((col) => col.label), records, errors, warnings };
}
