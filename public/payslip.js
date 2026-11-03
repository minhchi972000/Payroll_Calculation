// Dựng phiếu lương dùng chung cho trang nhân viên và phần "Xem phiếu" của admin, để hai bên hiển thị y hệt nhau
import { el, formatValue, netPayIndex, normalizeLabel } from './common.js';

// Chia mục lương thành nhóm theo tên cột, chỉ để hiển thị cho dễ đọc
const WORK_TIME = /ngay cong|nghi phep|phep nam|xin phep|^gio |so ngay|so gio/;
const DEDUCTION = /^(tru|khau tru|phi )|bhxh|bhyt|bhtn|bao hiem|cong doan|thue|tam ung|truy thu|phat/;
// Khoản được nhận dù tên có chữ của khoản trừ, ví dụ "Phụ cấp BHXH", "Tiền tăng ca"
const INCOME_PREFIX = /^(tien|luong|phu cap|ho tro|thuong)/;
const GROUPS = [
  { key: 'time', title: 'Ngày công & giờ làm' },
  { key: 'income', title: 'Lương & phụ cấp' },
  { key: 'deduction', title: 'Các khoản trừ' },
];

function classify(item) {
  const label = normalizeLabel(item.label);
  if (typeof item.value === 'string' && item.value !== '') return 'info';
  if (INCOME_PREFIX.test(label)) return 'income';
  // Ngày, giờ không bao giờ tới 1.000; số lớn hơn là tiền
  if (WORK_TIME.test(label) && !(Math.abs(item.value) >= 1000)) return 'time';
  if (DEDUCTION.test(label)) return 'deduction';
  return 'income';
}

const isZero = (item) => item.value === 0 || item.value === '';

export function money(value) {
  return typeof value === 'number' ? `${formatValue(value)} đ` : formatValue(value);
}

function renderGroup(group, items) {
  if (group.key === 'time') {
    return el(
      'section',
      { class: 'group' },
      el('h3', {}, group.title),
      el('dl', { class: 'tiles' }, items.map((item) => el('div', {}, el('dt', {}, item.label), el('dd', {}, formatValue(item.value))))),
    );
  }
  const deduction = group.key === 'deduction';
  return el(
    'section',
    { class: `group ${group.key}` },
    el('h3', {}, group.title),
    el(
      'dl',
      { class: 'items' },
      items.map((item) => {
        const negative = typeof item.value === 'number' && (item.value < 0 || (deduction && item.value !== 0));
        const value = deduction && typeof item.value === 'number' && item.value !== 0 ? `−${formatValue(Math.abs(item.value))}` : formatValue(item.value);
        return el('div', { class: negative ? 'row negative' : 'row' }, el('dt', {}, item.label), el('dd', {}, value));
      }),
    ),
  );
}

/**
 * @param {{label: string, value: string|number}[]} items
 * @param {boolean} showZero  hiện cả các mục bằng 0
 * @returns {{ net: object|undefined, info: string, groups: Node[], hiddenCount: number }}
 *   net: mục Thực lãnh; info: các mục dạng chữ (chức vụ…) để hiện dưới tên; groups: các nhóm đã dựng sẵn
 */
export function buildPayslip(items, showZero) {
  const net = items[netPayIndex(items.map((item) => item.label))];
  const info = items
    .filter((item) => item !== net && classify(item) === 'info')
    .map((item) => `${item.label}: ${item.value}`)
    .join(' · ');
  const rest = items.filter((item) => item !== net && classify(item) !== 'info');
  const shown = showZero ? rest : rest.filter((item) => !isZero(item));
  const groups = GROUPS.map((group) => {
    const groupItems = shown.filter((item) => classify(item) === group.key);
    return groupItems.length ? renderGroup(group, groupItems) : null;
  }).filter(Boolean);
  return { net, info, groups, hiddenCount: rest.filter(isZero).length };
}

export function zeroToggleText(showZero, hiddenCount) {
  return showZero ? 'Ẩn các mục bằng 0' : `Hiện thêm ${hiddenCount} mục bằng 0`;
}
