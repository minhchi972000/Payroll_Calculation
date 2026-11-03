import { api, el, formatPeriod, formatValue, normalizeLabel, showError } from './common.js';

const $ = (id) => document.getElementById(id);
const views = ['loading', 'login-view', 'change-view', 'payslip-view'];
const NET_PAY = /thuc (linh|lanh|nhan)|luong net|net pay|so tien (nhan|thuc nhan)|con (linh|nhan)/;

let profile = null;
// Mã vừa dùng để đăng nhập, để khỏi bắt nhập lại khi đổi mật khẩu lần đầu
let lastLoginPassword = '';

function show(view) {
  for (const id of views) $(id).hidden = id !== view;
}

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
    await api('/api/login', { method: 'POST', body: { phone: $('login-phone').value, password } });
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
  $('change-username').value = profile.phone;
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
  show('login-view');
});

function showPayslips() {
  $('emp-name').textContent = profile.name || 'Nhân viên';
  $('emp-phone').textContent = profile.phone;
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

async function loadPayslip(period) {
  showError($('payslip-error'), null);
  $('items').replaceChildren();
  $('net').hidden = true;
  try {
    const data = await api(`/api/payslip?period=${encodeURIComponent(period)}`);
    if (data.name) $('emp-name').textContent = data.name;

    const net = [...data.items].reverse().find((item) => NET_PAY.test(normalizeLabel(item.label)));
    if (net) {
      $('net-label').textContent = net.label;
      $('net-value').textContent = formatValue(net.value);
      $('net').hidden = false;
    }
    $('items').replaceChildren(
      ...data.items.map((item) =>
        el(
          'div',
          { class: typeof item.value === 'number' && item.value < 0 ? 'row negative' : 'row' },
          el('dt', {}, item.label),
          el('dd', {}, formatValue(item.value)),
        ),
      ),
    );
  } catch (err) {
    if (err.status === 401) return show('login-view');
    showError($('payslip-error'), err);
  }
}

boot();
