import { api, el, formatPeriod, hidePasswords, initPasswordToggles, showError } from './common.js';
import { buildPayslip, money, zeroToggleText } from './payslip.js';

const $ = (id) => document.getElementById(id);
const views = ['loading', 'login-view', 'payslip-view'];
let profile = null;
let payslip = null;
let showZero = false;

function show(view) {
  for (const id of views) $(id).hidden = id !== view;
  hidePasswords();
}

initPasswordToggles();

async function boot() {
  try {
    profile = await api('/api/me');
  } catch (err) {
    show('login-view');
    if (err.status !== 401) return showError($('login-error'), err);
    // Admin đã đăng nhập thì vào thẳng trang quản lý
    if (await api('/api/admin/me').then(() => true, () => false)) location.replace('/admin');
    return;
  }
  showPayslips();
}

const CCCD_LENGTH = 12;

// Ô CCCD chỉ nhận chữ số, tối đa 12 số (dán "079 300 001 234" cũng được)
function updateLoginIdCount() {
  const count = $('login-id').value.length;
  $('login-id-count').textContent = count === CCCD_LENGTH ? 'Đủ 12 số ✓' : `${count}/${CCCD_LENGTH} số`;
  $('login-id-count').classList.toggle('ok', count === CCCD_LENGTH);
}

$('login-id').addEventListener('input', () => {
  $('login-id').value = $('login-id').value.replace(/\D/g, '').slice(0, CCCD_LENGTH);
  updateLoginIdCount();
});

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  showError($('login-error'), null);
  if ($('login-id').value.length !== CCCD_LENGTH) {
    return showError($('login-error'), new Error(`Số CCCD phải có đủ ${CCCD_LENGTH} chữ số.`));
  }
  button.disabled = true;
  try {
    const password = $('login-password').value;
    const result = await api('/api/login', { method: 'POST', body: { loginId: $('login-id').value, password } });
    // Tài khoản admin: sang trang quản lý
    if (result.admin) {
      location.href = '/admin';
      return;
    }
    $('login-password').value = '';
    await boot();
  } catch (err) {
    showError($('login-error'), err);
  } finally {
    button.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' }).catch(() => {});
  profile = null;
  payslip = null;
  showZero = false;
  show('login-view');
});

function showPayslips() {
  $('emp-name').textContent = profile.name || 'Nhân viên';
  $('emp-id').textContent = `Số CCCD: ${profile.loginId}`;
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

function renderPayslip() {
  const { items, period } = payslip;
  const { net, info, groups, hiddenCount } = buildPayslip(items, showZero);
  $('net').hidden = !net;
  if (net) {
    $('net-label').textContent = `${net.label} · ${formatPeriod(period)}`;
    $('net-value').textContent = money(net.value);
  }
  // Mục dạng chữ (chức vụ, bộ phận…) hiện ngay dưới tên
  $('emp-info').textContent = info;
  $('groups').replaceChildren(...groups);
  $('toggle-zero').hidden = hiddenCount === 0;
  $('toggle-zero').textContent = zeroToggleText(showZero, hiddenCount);
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
