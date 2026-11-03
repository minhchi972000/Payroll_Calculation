import { api, el, formatPeriod, formatValue, hidePasswords, initPasswordToggles, loginIdLabel, normalizeLabel, showError } from './common.js';

const $ = (id) => document.getElementById(id);
const views = ['loading', 'login-view', 'change-view', 'payslip-view'];
const NET_PAY = /thuc (linh|lanh|nhan)|luong net|net pay|so tien (nhan|thuc nhan)|con (linh|nhan)/;
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

let profile = null;
let payslip = null;
let showZero = false;
// Mã vừa dùng để đăng nhập, để khỏi bắt nhập lại khi đổi mật khẩu lần đầu
let lastLoginPassword = '';

function show(view) {
  for (const id of views) $(id).hidden = id !== view;
  hidePasswords();
}

initPasswordToggles();

async function boot() {
  try {
    profile = await api('/api/me');
  } catch (err) {
    if (err.status === 401) return show('login-view');
    show('login-view');
    return showError($('login-error'), err);
  }
  if (profile.mustChangePassword) return showChangePassword(true);
  showPayslips();
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  showError($('login-error'), null);
  button.disabled = true;
  try {
    const password = $('login-password').value;
    await api('/api/login', { method: 'POST', body: { loginId: $('login-id').value, password } });
    lastLoginPassword = password;
    $('login-password').value = '';
    await boot();
  } catch (err) {
    showError($('login-error'), err);
  } finally {
    button.disabled = false;
  }
});

function showChangePassword(firstTime) {
  $('change-title').textContent = firstTime ? 'Đặt mật khẩu mới' : 'Đổi mật khẩu';
  $('change-intro').hidden = !firstTime;
  $('change-cancel').hidden = firstTime;
  $('change-username').value = profile.loginId;
  $('change-current').value = firstTime ? lastLoginPassword : '';
  $('change-current-wrap').hidden = firstTime && lastLoginPassword !== '';
  $('change-new').value = '';
  $('change-confirm').value = '';
  showError($('change-error'), null);
  show('change-view');
}

$('change-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  showError($('change-error'), null);
  if ($('change-new').value !== $('change-confirm').value) {
    return showError($('change-error'), new Error('Hai mật khẩu mới không giống nhau.'));
  }
  button.disabled = true;
  try {
    await api('/api/change-password', {
      method: 'POST',
      body: { currentPassword: $('change-current').value, newPassword: $('change-new').value },
    });
    lastLoginPassword = '';
    await boot();
  } catch (err) {
    showError($('change-error'), err);
  } finally {
    button.disabled = false;
  }
});

$('change-cancel').addEventListener('click', () => show('payslip-view'));
$('open-change').addEventListener('click', () => showChangePassword(false));

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  profile = null;
  payslip = null;
  showZero = false;
  show('login-view');
});

function showPayslips() {
  $('emp-name').textContent = profile.name || 'Nhân viên';
  $('emp-id').textContent = `${loginIdLabel(profile.loginId)}: ${profile.loginId}`;
  const select = $('period');
  select.replaceChildren(...profile.periods.map((p) => el('option', { value: p }, formatPeriod(p))));
  const hasAny = profile.periods.length > 0;
  $('period-wrap').hidden = !hasAny;
  $('no-payslip').hidden = hasAny;
  $('payslip-card').hidden = !hasAny;
  show('payslip-view');
  if (hasAny) loadPayslip(profile.periods[0]);
}

$('period').addEventListener('change', (event) => loadPayslip(event.target.value));

$('toggle-zero').addEventListener('click', () => {
  showZero = !showZero;
  renderPayslip();
});

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

function money(value) {
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

function renderPayslip() {
  const { items, period } = payslip;
  const net = [...items].reverse().find((item) => NET_PAY.test(normalizeLabel(item.label)));
  $('net').hidden = !net;
  if (net) {
    $('net-label').textContent = `${net.label} · ${formatPeriod(period)}`;
    $('net-value').textContent = money(net.value);
  }

  // Mục dạng chữ (chức vụ, bộ phận…) hiện ngay dưới tên
  $('emp-info').textContent = items
    .filter((item) => item !== net && classify(item) === 'info')
    .map((item) => `${item.label}: ${item.value}`)
    .join(' · ');

  const rest = items.filter((item) => item !== net && classify(item) !== 'info');
  const hidden = rest.filter(isZero).length;
  const shown = showZero ? rest : rest.filter((item) => !isZero(item));
  $('groups').replaceChildren(
    ...GROUPS.map((group) => {
      const groupItems = shown.filter((item) => classify(item) === group.key);
      return groupItems.length ? renderGroup(group, groupItems) : null;
    }).filter(Boolean),
  );
  $('toggle-zero').hidden = hidden === 0;
  $('toggle-zero').textContent = showZero ? 'Ẩn các mục bằng 0' : `Hiện thêm ${hidden} mục bằng 0`;
}

async function loadPayslip(period) {
  showError($('payslip-error'), null);
  $('payslip-card').classList.add('loading');
  try {
    const data = await api(`/api/payslip?period=${encodeURIComponent(period)}`);
    if (data.name) $('emp-name').textContent = data.name;
    payslip = data;
    renderPayslip();
  } catch (err) {
    if (err.status === 401) return show('login-view');
    $('groups').replaceChildren();
    $('emp-info').textContent = '';
    $('net').hidden = true;
    $('toggle-zero').hidden = true;
    showError($('payslip-error'), err);
  } finally {
    $('payslip-card').classList.remove('loading');
  }
}

boot();
