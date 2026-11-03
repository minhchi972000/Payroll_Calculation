import { api, el, formatDateTime, formatPeriod, formatValue, hidePasswords, initPasswordToggles, showError } from '../common.js';

const $ = (id) => document.getElementById(id);

let config = { googleServiceAccount: null };
let workbook = null;
let pendingImport = null;
let employees = [];

function show(view) {
  for (const id of ['loading', 'login-view', 'app-view']) $(id).hidden = id !== view;
  hidePasswords();
}

initPasswordToggles();

async function boot() {
  try {
    config = await api('/api/admin/me');
  } catch (err) {
    show('login-view');
    if (err.status !== 401) showError($('login-error'), err);
    return;
  }
  $('gsheet-missing').hidden = Boolean(config.googleServiceAccount);
  $('gsheet-ready').hidden = !config.googleServiceAccount;
  $('gsheet-email').textContent = config.googleServiceAccount || '';
  show('app-view');
}

$('login-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  showError($('login-error'), null);
  try {
    await api('/api/admin/login', { method: 'POST', body: { username: $('admin-username').value, password: $('admin-password').value } });
    $('admin-password').value = '';
    await boot();
  } catch (err) {
    showError($('login-error'), err);
  } finally {
    button.disabled = false;
  }
});

$('logout').addEventListener('click', async () => {
  await api('/api/admin/logout', { method: 'POST' }).catch(() => {});
  show('login-view');
});

// Ghi tên cột vào từng ô để trên điện thoại bảng hiện thành thẻ (CSS table.cards)
function asCards(table) {
  const heads = [...table.querySelectorAll('thead th')].map((th) => th.textContent);
  table.classList.add('cards');
  table.querySelectorAll('tbody tr').forEach((tr) => {
    [...tr.children].forEach((td, i) => {
      if (heads.length) td.dataset.label = heads[i] ?? '';
    });
  });
  return table;
}

function handleAuthError(err, errorBox) {
  if (err.status === 401) {
    show('login-view');
    return;
  }
  showError(errorBox, err);
}

// ---------- Tabs ----------

document.querySelectorAll('.tabs button').forEach((button) => {
  button.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((b) => b.classList.toggle('active', b === button));
    for (const tab of ['import', 'periods', 'employees']) $(`tab-${tab}`).hidden = tab !== button.dataset.tab;
    if (button.dataset.tab === 'periods') loadPeriods();
    if (button.dataset.tab === 'employees') loadEmployees();
  });
});

// ---------- Nhập bảng lương ----------

function monthsFromNow(offset) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Danh sách tháng bằng tiếng Việt ("Tháng 10/2026"), vì ô type="month" của trình duyệt
// hiện theo ngôn ngữ máy (ví dụ "October 2026"). Từ tháng sau lùi về 24 tháng.
$('import-period').replaceChildren(
  ...Array.from({ length: 26 }, (_, i) => {
    const period = monthsFromNow(1 - i);
    return el('option', { value: period }, formatPeriod(period));
  }),
);
// Lương thường chốt cho tháng trước
$('import-period').value = monthsFromNow(-1);

function currentSource() {
  return document.querySelector('input[name="source"]:checked').value;
}

document.querySelectorAll('input[name="source"]').forEach((radio) => {
  radio.addEventListener('change', () => {
    $('excel-source').hidden = currentSource() !== 'excel';
    $('gsheet-source').hidden = currentSource() !== 'gsheet';
    resetImportSteps();
  });
});

function resetImportSteps() {
  pendingImport = null;
  $('summary-card').hidden = true;
  $('result-card').hidden = true;
  showError($('import-error'), null);
}

$('import-period').addEventListener('change', resetImportSteps);
$('import-url').addEventListener('input', resetImportSteps);
$('import-sheet').addEventListener('change', resetImportSteps);

$('import-file').addEventListener('change', async () => {
  resetImportSteps();
  workbook = null;
  $('sheet-wrap').hidden = true;
  const file = $('import-file').files[0];
  $('import-file-name').textContent = file ? file.name : 'Chưa chọn file';
  if (!file) return;
  try {
    workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellNF: true });
  } catch {
    showError($('import-error'), new Error('Không đọc được file. Hãy lưu lại dưới dạng .xlsx rồi thử lại.'));
    return;
  }
  $('import-sheet').replaceChildren(...workbook.SheetNames.map((name) => el('option', { value: name }, name)));
  $('sheet-wrap').hidden = workbook.SheetNames.length < 2;
});

function cellValue(cell) {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.t === 'n') {
    const format = String(cell.z || '');
    if (XLSX.SSF.is_date(format)) {
      return XLSX.SSF.format(/h|s/i.test(format.replace(/\[[^\]]*\]/g, '')) ? 'dd/mm/yyyy hh:mm' : 'dd/mm/yyyy', cell.v);
    }
    if (format.includes('%')) return cell.w ?? cell.v;
    return cell.v;
  }
  if (cell.t === 'e') return '';
  if (cell.t === 'b') return cell.v;
  return String(cell.w ?? cell.v);
}

// Chuyển sheet thành mảng 2 chiều. Ô gộp (merge) được điền giá trị vào mọi ô con,
// để tiêu đề gộp như "Khấu trừ" nằm trên "BHXH", "BHYT" vẫn đọc được.
function sheetToRows(sheet) {
  let maxRow = -1;
  let maxCol = -1;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    const cell = sheet[key];
    if (cell.v === undefined || cell.v === null || cell.v === '') continue;
    const { r, c } = XLSX.utils.decode_cell(key);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }
  const rows = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = [];
    for (let c = 0; c <= maxCol; c++) row.push(cellValue(sheet[XLSX.utils.encode_cell({ r, c })]));
    rows.push(row);
  }
  for (const m of sheet['!merges'] || []) {
    const value = rows[m.s.r]?.[m.s.c];
    for (let r = m.s.r; r <= Math.min(m.e.r, maxRow); r++) {
      for (let c = m.s.c; c <= Math.min(m.e.c, maxCol); c++) rows[r][c] = value;
    }
  }
  return rows;
}

function buildImportRequest() {
  const period = $('import-period').value;
  if (!period) throw new Error('Vui lòng chọn tháng lương.');
  if (currentSource() === 'gsheet') {
    const sheetUrl = $('import-url').value.trim();
    if (!sheetUrl) throw new Error('Vui lòng dán link Google Sheet.');
    return { period, source: 'gsheet', sheetUrl };
  }
  if (!workbook) throw new Error('Vui lòng chọn file bảng lương.');
  const sheetName = $('import-sheet').value || workbook.SheetNames[0];
  const fileName = $('import-file').files[0]?.name || 'Excel';
  return {
    period,
    source: 'excel',
    fileName: workbook.SheetNames.length > 1 ? `${fileName} (sheet ${sheetName})` : fileName,
    rows: sheetToRows(workbook.Sheets[sheetName]),
  };
}

$('check-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  resetImportSteps();
  button.disabled = true;
  try {
    const request = buildImportRequest();
    const summary = await api('/api/admin/import', { method: 'POST', body: { ...request, dryRun: true } });
    pendingImport = request;
    renderSummary(summary);
  } catch (err) {
    handleAuthError(err, $('import-error'));
  } finally {
    button.disabled = false;
  }
});

function messageList(title, items, cls) {
  if (!items.length) return null;
  const shown = items.slice(0, 20);
  return el(
    'div',
    { class: cls },
    el('b', {}, title),
    el('ul', { class: 'messages' }, shown.map((text) => el('li', {}, text)), items.length > 20 ? el('li', {}, `… và ${items.length - 20} dòng khác`) : null),
  );
}

function renderSummary(s) {
  const blocks = [
    el('p', {}, `${formatPeriod(s.period)} · Nguồn: ${s.source}`),
    el(
      'p',
      {},
      el('b', {}, `${s.rowCount} nhân viên`),
      s.newEmployeeCount ? ` (trong đó ${s.newEmployeeCount} người mới, hệ thống sẽ tạo mã đăng nhập)` : '',
    ),
    s.idLabel ? el('p', { class: 'muted' }, `Nhân viên đăng nhập bằng cột: ${s.idLabel}`) : null,
    s.replacesExisting ? el('p', { class: 'notice' }, `${formatPeriod(s.period)} đã có dữ liệu của ${s.replacesExisting} người. Nhập lại sẽ thay thế toàn bộ dữ liệu cũ của kỳ này.`) : null,
    el('div', {}, el('span', { class: 'muted' }, `Các cột nhân viên sẽ thấy (${s.columns.length}):`), el('div', { class: 'chips' }, s.columns.map((c) => el('span', {}, c)))),
    messageList('Lỗi cần sửa trong file:', s.errors, 'error'),
    messageList('Lưu ý:', s.warnings, 'notice'),
  ];
  if (s.preview.length) {
    const first = s.preview[0];
    blocks.push(
      el('p', { class: 'muted' }, `Xem trước dòng đầu tiên: ${first.name || ''} · ${s.idLabel} ${first.loginId}`),
      el(
        'div',
        { class: 'table-scroll' },
        el('table', {}, el('tbody', {}, s.columns.map((label, i) => el('tr', {}, el('th', {}, label), el('td', {}, formatValue(first.values[i])))))),
      ),
    );
  }
  $('summary').replaceChildren(...blocks.filter(Boolean));
  $('confirm-btn').hidden = s.errors.length > 0;
  showError($('confirm-error'), null);
  $('summary-card').hidden = false;
}

$('confirm-btn').addEventListener('click', async (event) => {
  if (!pendingImport) return;
  const button = event.currentTarget;
  button.disabled = true;
  showError($('confirm-error'), null);
  try {
    const result = await api('/api/admin/import', { method: 'POST', body: { ...pendingImport, dryRun: false } });
    if (!result.imported) {
      renderSummary(result);
      return;
    }
    pendingImport = null;
    $('summary-card').hidden = true;
    renderResult(result);
  } catch (err) {
    handleAuthError(err, $('confirm-error'));
  } finally {
    button.disabled = false;
  }
});

// Tin nhắn chung gửi cả nhóm (Zalo): mật khẩu ban đầu là 6 số cuối CCCD nên không cần gửi riêng
function loginMessage() {
  return [
    `Bảng lương xem tại: ${location.origin}`,
    'Đăng nhập bằng số CCCD (đủ 12 số).',
    'Mật khẩu lần đầu: 6 số cuối số CCCD của bạn. Sau đó hệ thống sẽ yêu cầu đặt mật khẩu riêng.',
  ].join('\n');
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const old = button.textContent;
    button.textContent = 'Đã chép ✓';
    setTimeout(() => (button.textContent = old), 1500);
  } catch {
    window.prompt('Sao chép nội dung dưới đây:', text);
  }
}

function accountsTable(accounts) {
  return el(
    'div',
    { class: 'table-scroll' },
    asCards(el(
      'table',
      {},
      el('thead', {}, el('tr', {}, el('th', {}, 'Họ tên'), el('th', {}, 'Số CCCD'))),
      el('tbody', {}, accounts.map((a) => el('tr', {}, el('td', {}, a.name || '—'), el('td', {}, a.loginId)))),
    )),
  );
}

function renderResult(r) {
  const blocks = [el('p', { class: 'success' }, `Đã nhập ${r.rowCount} phiếu lương cho ${formatPeriod(r.period)}. Nhân viên đã có thể xem ngay.`)];
  if (r.newAccounts.length) {
    blocks.push(
      el(
        'p',
        { class: 'notice' },
        `Có ${r.newAccounts.length} nhân viên mới. Mật khẩu lần đầu của mỗi người là `,
        el('b', {}, '6 số cuối số CCCD'),
        '. Gửi tin nhắn hướng dẫn dưới đây vào nhóm Zalo của công ty.',
      ),
      el('pre', { class: 'message' }, loginMessage()),
      el('div', { class: 'row-actions' }, el('button', { class: 'ghost', type: 'button', onclick: (e) => copyText(loginMessage(), e.currentTarget) }, 'Sao chép tin nhắn')),
      accountsTable(r.newAccounts),
    );
  }
  $('result').replaceChildren(...blocks);
  $('result-card').hidden = false;
}

// ---------- Kỳ lương ----------

async function loadPeriods() {
  showError($('periods-error'), null);
  try {
    const { periods } = await api('/api/admin/periods');
    const table = $('periods-table');
    if (!periods.length) {
      table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'muted' }, 'Chưa có kỳ lương nào.'))));
      return;
    }
    table.replaceChildren(
      el('thead', {}, el('tr', {}, el('th', {}, 'Kỳ lương'), el('th', {}, 'Số người'), el('th', {}, 'Nguồn'), el('th', {}, 'Nhập lúc'), el('th', {}, ''))),
      el(
        'tbody',
        {},
        periods.map((p) =>
          el(
            'tr',
            {},
            el('td', {}, formatPeriod(p.period)),
            el('td', {}, p.count),
            el('td', {}, p.source),
            el('td', {}, formatDateTime(p.imported_at)),
            el(
              'td',
              { class: 'actions' },
              el('button', { class: 'ghost', type: 'button', onclick: (e) => exportPeriod(p.period, e.currentTarget) }, 'Xuất Excel'),
              el('button', { class: 'danger', type: 'button', onclick: () => deletePeriod(p.period) }, 'Xoá'),
            ),
          ),
        ),
      ),
    );
    asCards(table);
  } catch (err) {
    handleAuthError(err, $('periods-error'));
  }
}

// Xuất bảng lương một kỳ ra Excel: cột Họ tên, Số CCCD rồi đúng các cột đã nhập, cuối cùng là dòng tổng.
// File này nhập lại vào web được (dòng tổng tự bị bỏ qua).
async function exportPeriod(period, button) {
  showError($('periods-error'), null);
  button.disabled = true;
  try {
    const { columns, rows } = await api(`/api/admin/periods/${period}/export`);
    const header = ['STT', 'HỌ & TÊN', 'SỐ CCCD', ...columns];
    const firstRow = 4; // dòng Excel của nhân viên đầu tiên (sau tiêu đề trang, dòng trống, tiêu đề cột)
    const lastRow = firstRow + rows.length - 1;
    const totals = columns.map((_, i) => {
      const numeric = rows.length > 0 && rows.every((r) => typeof r.values[i] === 'number' || r.values[i] === '');
      if (!numeric) return '';
      const letter = XLSX.utils.encode_col(i + 3);
      const sum = rows.reduce((s, r) => s + (typeof r.values[i] === 'number' ? r.values[i] : 0), 0);
      return { t: 'n', v: sum, f: `SUM(${letter}${firstRow}:${letter}${lastRow})` };
    });
    const sheet = XLSX.utils.aoa_to_sheet([
      [`BẢNG LƯƠNG ${formatPeriod(period).toUpperCase()}`],
      [],
      header,
      ...rows.map((r, i) => [i + 1, r.name, r.loginId, ...r.values]),
      ['', 'TỔNG CỘNG', '', ...totals],
    ]);
    // Tiền có dấu phân cách hàng nghìn; ngày, giờ để nguyên
    for (const [ref, cell] of Object.entries(sheet)) {
      if (ref.startsWith('!') || cell.t !== 'n') continue;
      const { r, c } = XLSX.utils.decode_cell(ref);
      if (r >= firstRow - 1 && c >= 3 && Number.isInteger(cell.v) && Math.abs(cell.v) >= 1000) cell.z = '#,##0';
    }
    sheet['!cols'] = header.map((h, i) => ({ wch: i === 0 ? 5 : i === 1 ? 24 : i === 2 ? 15 : Math.min(Math.max(String(h).length, 10), 22) }));
    const [year, month] = period.split('-');
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, `T${month}-${year}`);
    XLSX.writeFile(book, `bang-luong-${period}.xlsx`);
  } catch (err) {
    handleAuthError(err, $('periods-error'));
  } finally {
    button.disabled = false;
  }
}

async function deletePeriod(period) {
  if (!confirm(`Xoá toàn bộ bảng lương ${formatPeriod(period)}? Nhân viên sẽ không xem được kỳ này nữa.`)) return;
  try {
    await api(`/api/admin/periods/${period}`, { method: 'DELETE' });
    loadPeriods();
  } catch (err) {
    handleAuthError(err, $('periods-error'));
  }
}

// ---------- Nhân viên ----------

async function loadEmployees() {
  showError($('employees-error'), null);
  try {
    ({ employees } = await api('/api/admin/employees'));
    renderEmployees();
  } catch (err) {
    handleAuthError(err, $('employees-error'));
  }
}

$('employee-search').addEventListener('input', renderEmployees);

function renderEmployees() {
  const q = $('employee-search').value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = employees.filter((e) => !q || e.name.toLowerCase().includes(q) || (digits && e.login_id.includes(digits)));
  const table = $('employees-table');
  if (!list.length) {
    table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'muted' }, employees.length ? 'Không tìm thấy.' : 'Chưa có nhân viên. Nhập bảng lương để tạo tài khoản.'))));
    return;
  }
  table.replaceChildren(
    el('thead', {}, el('tr', {}, el('th', {}, 'Họ tên'), el('th', {}, 'Số CCCD'), el('th', {}, 'Trạng thái'), el('th', {}, 'Đăng nhập gần nhất'), el('th', {}, ''))),
    el(
      'tbody',
      {},
      list.map((e) =>
        el(
          'tr',
          {},
          el('td', {}, e.name || '—'),
          el('td', {}, e.login_id),
          el('td', {}, e.must_change_password ? el('span', { class: 'tag' }, 'Chưa kích hoạt') : el('span', { class: 'tag ok' }, 'Đã đặt mật khẩu')),
          el('td', {}, formatDateTime(e.last_login_at)),
          el(
            'td',
            { class: 'actions' },
            el('button', { class: 'ghost', type: 'button', onclick: () => resetPassword(e) }, 'Đặt lại mật khẩu'),
            el('button', { class: 'danger', type: 'button', onclick: () => deleteEmployee(e) }, 'Xoá'),
          ),
        ),
      ),
    ),
  );
  asCards(table);
}

// Khung đặt lại mật khẩu: về 6 số cuối CCCD, hoặc mật khẩu do admin tự đặt
function resetPassword(employee) {
  const who = employee.name || employee.login_id;
  const card = $('code-card');
  const input = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ít nhất 6 ký tự' });
  const mustChange = el('input', { type: 'checkbox', checked: true });
  const customWrap = el(
    'div',
    { hidden: true },
    el('div', { class: 'password' }, input, el('button', { type: 'button', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false' }, 'Hiện')),
    el('label', { class: 'choice' }, mustChange, 'Bắt nhân viên đặt mật khẩu riêng khi đăng nhập'),
  );
  const modeRadio = (value, text, checked) =>
    el('label', { class: 'choice' }, el('input', { type: 'radio', name: 'reset-mode', value, checked, onchange: () => (customWrap.hidden = value !== 'custom') }), text);
  const error = el('p', { class: 'error', hidden: true });

  async function save(event) {
    event.preventDefault();
    const custom = card.querySelector('input[name="reset-mode"]:checked').value === 'custom';
    if (custom && input.value.length < 6) return showError(error, new Error('Mật khẩu phải có ít nhất 6 ký tự.'));
    const button = event.submitter;
    button.disabled = true;
    showError(error, null);
    try {
      const result = await api(`/api/admin/employees/${employee.login_id}/reset`, {
        method: 'POST',
        body: custom ? { password: input.value, mustChange: mustChange.checked } : {},
      });
      const how = result.custom ? 'mật khẩu admin vừa đặt' : '6 số cuối số CCCD';
      const next = result.mustChange ? 'Lần đăng nhập tới, người đó sẽ phải đặt mật khẩu riêng.' : 'Người đó dùng luôn mật khẩu này để đăng nhập.';
      card.replaceChildren(el('p', { class: 'success' }, `Đã đặt mật khẩu của ${who} (CCCD ${employee.login_id}) thành ${how}. ${next}`));
      loadEmployees();
    } catch (err) {
      button.disabled = false;
      if (err.status === 401) return show('login-view');
      showError(error, err);
    }
  }

  card.replaceChildren(
    el(
      'form',
      { onsubmit: save, novalidate: true },
      el('h2', {}, `Đặt lại mật khẩu: ${who}`),
      el('p', { class: 'muted' }, `Số CCCD ${employee.login_id}. Mật khẩu cũ sẽ không dùng được nữa.`),
      modeRadio('cccd', '6 số cuối số CCCD (nhân viên phải đổi khi đăng nhập)', true),
      modeRadio('custom', 'Mật khẩu do admin đặt', false),
      customWrap,
      el(
        'div',
        { class: 'row-actions' },
        el('button', { class: 'primary', type: 'submit' }, 'Lưu mật khẩu'),
        el('button', { class: 'ghost', type: 'button', onclick: () => (card.hidden = true) }, 'Huỷ'),
      ),
      error,
    ),
  );
  initPasswordToggles(card);
  card.hidden = false;
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function deleteEmployee(employee) {
  if (!confirm(`Xoá ${employee.name || employee.login_id} cùng toàn bộ phiếu lương của người này?`)) return;
  try {
    await api(`/api/admin/employees/${employee.login_id}`, { method: 'DELETE' });
    loadEmployees();
  } catch (err) {
    handleAuthError(err, $('employees-error'));
  }
}

boot();
