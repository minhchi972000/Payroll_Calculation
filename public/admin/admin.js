import { api, el, formatDateTime, formatPeriod, formatValue, hidePasswords, initPasswordToggles, netPayIndex, showError } from '../common.js';

const $ = (id) => document.getElementById(id);

let config = { googleServiceAccount: null };
let workbook = null;
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

// Một bước: bấm là nhập luôn. Server tự kiểm tra; file có lỗi thì không nhập gì và trả về danh sách lỗi.
$('import-btn').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  resetImportSteps();
  button.disabled = true;
  try {
    const request = buildImportRequest();
    // Tháng đã có bảng lương thì hỏi lại trước khi thay thế
    const { periods } = await api('/api/admin/periods');
    const existing = periods.find((p) => p.period === request.period);
    if (
      existing &&
      !confirm(`${formatPeriod(request.period)} đã có bảng lương của ${existing.count} người. Nhập file này sẽ thay thế toàn bộ dữ liệu cũ của tháng đó. Tiếp tục?`)
    ) {
      return;
    }
    const result = await api('/api/admin/import', { method: 'POST', body: { ...request, dryRun: false } });
    if (result.imported) renderResult(result);
    else renderErrors(result);
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

function renderErrors(s) {
  $('summary').replaceChildren(
    ...[
      el('p', { class: 'muted' }, `${formatPeriod(s.period)} · Nguồn: ${s.source}. Chưa có gì được nhập, dữ liệu cũ giữ nguyên.`),
      messageList('Lỗi cần sửa trong file, sửa xong bấm Nhập bảng lương lại:', s.errors, 'error'),
      messageList('Lưu ý:', s.warnings, 'notice'),
    ].filter(Boolean),
  );
  $('summary-card').hidden = false;
}

// Tin nhắn chung gửi cả nhóm (Zalo): mật khẩu mặc định là 6 số cuối CCCD nên không cần gửi riêng
function loginMessage() {
  return [
    `Bảng lương xem tại: ${location.origin}`,
    'Đăng nhập bằng số CCCD (đủ 12 số).',
    'Mật khẩu: 6 số cuối số CCCD của bạn. Quên mật khẩu thì liên hệ admin.',
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
  const blocks = [
    el(
      'p',
      { class: 'success' },
      `Đã nhập ${r.rowCount} phiếu lương cho ${formatPeriod(r.period)} (${r.columns.length} cột). Nhân viên đã có thể xem ngay.`,
      r.replacesExisting ? ` Dữ liệu cũ của ${r.replacesExisting} người trong tháng này đã được thay thế.` : '',
    ),
    messageList('Lưu ý:', r.warnings, 'notice'),
  ].filter(Boolean);
  if (r.newAccounts.length) {
    blocks.push(
      el(
        'p',
        { class: 'notice' },
        `Có ${r.newAccounts.length} nhân viên mới. Mật khẩu của mỗi người là `,
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

// Lọc theo tháng: '' là tất cả nhân viên; 'YYYY-MM' là chỉ người có phiếu lương tháng đó (kèm cột Thực lãnh)
let employeePeriod = '';
let periodSlips = null; // { net, byId: Map(CCCD -> values) } của tháng đang lọc

async function loadEmployees() {
  showError($('employees-error'), null);
  try {
    const [list, { periods }] = await Promise.all([api('/api/admin/employees'), api('/api/admin/periods')]);
    employees = list.employees;
    const months = periods.map((p) => p.period);
    if (!months.includes(employeePeriod)) employeePeriod = '';
    $('employee-period').replaceChildren(
      el('option', { value: '' }, 'Tất cả nhân viên'),
      ...months.map((p) => el('option', { value: p }, formatPeriod(p))),
    );
    $('employee-period').value = employeePeriod;
    await loadPeriodSlips();
    renderEmployees();
  } catch (err) {
    handleAuthError(err, $('employees-error'));
  }
}

async function loadPeriodSlips() {
  periodSlips = null;
  if (!employeePeriod) return;
  const { columns, rows } = await api(`/api/admin/periods/${employeePeriod}/export`);
  periodSlips = { net: netPayIndex(columns), byId: new Map(rows.map((r) => [r.loginId, r.values])) };
}

$('employee-period').addEventListener('change', async () => {
  employeePeriod = $('employee-period').value;
  showError($('employees-error'), null);
  try {
    await loadPeriodSlips();
    renderEmployees();
  } catch (err) {
    handleAuthError(err, $('employees-error'));
  }
});

$('employee-search').addEventListener('input', renderEmployees);

const money = (value) => (typeof value === 'number' ? `${formatValue(value)} đ` : formatValue(value));

function renderEmployees() {
  const q = $('employee-search').value.trim().toLowerCase();
  const digits = q.replace(/\D/g, '');
  const list = employees.filter(
    (e) =>
      (!periodSlips || periodSlips.byId.has(e.login_id)) &&
      (!q || e.name.toLowerCase().includes(q) || (digits && e.login_id.includes(digits))),
  );
  const showNet = periodSlips && periodSlips.net !== -1;
  $('employee-count').textContent = `${list.length} người`;
  const table = $('employees-table');
  if (!list.length) {
    const empty = !employees.length ? 'Chưa có nhân viên. Nhập bảng lương để tạo tài khoản.' : q ? 'Không tìm thấy.' : 'Không có ai trong tháng này.';
    table.replaceChildren(el('tbody', {}, el('tr', {}, el('td', { class: 'muted' }, empty))));
    return;
  }
  table.replaceChildren(
    el(
      'thead',
      {},
      el(
        'tr',
        {},
        el('th', {}, 'Họ tên'),
        el('th', {}, 'Số CCCD'),
        showNet ? el('th', { class: 'num' }, `Thực lãnh ${formatPeriod(employeePeriod).toLowerCase()}`) : null,
        el('th', {}, 'Mật khẩu'),
        el('th', {}, 'Đăng nhập gần nhất'),
        el('th', {}, ''),
      ),
    ),
    el(
      'tbody',
      {},
      list.map((e) =>
        el(
          'tr',
          {},
          el('td', {}, e.name || '—'),
          el('td', {}, e.login_id),
          showNet ? el('td', { class: 'num' }, money(periodSlips.byId.get(e.login_id)[periodSlips.net])) : null,
          el('td', {}, e.default_password ? el('span', { class: 'tag' }, '6 số cuối CCCD') : el('span', { class: 'tag ok' }, 'Admin đã đặt')),
          el('td', {}, formatDateTime(e.last_login_at)),
          el(
            'td',
            { class: 'actions' },
            el('button', { class: 'ghost', type: 'button', onclick: () => showPayslipDetail(e) }, 'Xem phiếu'),
            el('button', { class: 'ghost', type: 'button', onclick: () => resetPassword(e) }, 'Đổi mật khẩu'),
            el('button', { class: 'danger', type: 'button', onclick: () => deleteEmployee(e) }, 'Xoá'),
          ),
        ),
      ),
    ),
  );
  asCards(table);
}

// Ô số gõ theo kiểu Việt Nam: "1.234.567" hoặc "12,5". Không phải số thì giữ nguyên chữ.
function parseCellInput(text) {
  const t = text.trim();
  if (t === '') return '';
  if (/^-?[\d.\s]+(,\d+)?$/.test(t)) {
    const n = Number(t.replace(/[.\s]/g, '').replace(',', '.'));
    if (Number.isFinite(n)) return n;
  }
  return t;
}

// Xem chi tiết phiếu lương của một nhân viên theo từng tháng; admin bấm "Chỉnh sửa" để sửa từng ô
async function showPayslipDetail(employee) {
  const card = $('detail-card');
  const who = employee.name || employee.login_id;
  const head = el('div', { class: 'detail-head' }, el('h2', {}, `Phiếu lương: ${who}`), el('span', { class: 'muted' }, `CCCD ${employee.login_id}`));
  const closeButton = () => el('button', { class: 'ghost', type: 'button', onclick: () => (card.hidden = true) }, 'Đóng');
  card.hidden = false;
  card.replaceChildren(head, el('p', { class: 'muted' }, 'Đang tải…'));
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let payslips;
  try {
    ({ payslips } = await api(`/api/admin/employees/${employee.login_id}/payslips`));
  } catch (err) {
    if (err.status === 401) return show('login-view');
    card.replaceChildren(head, el('p', { class: 'error' }, err.message), closeButton());
    return;
  }
  if (!payslips.length) {
    card.replaceChildren(head, el('p', { class: 'notice' }, 'Người này chưa có phiếu lương nào.'), closeButton());
    return;
  }

  let current = payslips.find((p) => p.period === employeePeriod) || payslips[0];
  let editing = false;
  let saved = false;

  function render() {
    const net = netPayIndex(current.columns);
    const inputs = [];
    const error = el('p', { class: 'error', hidden: true });

    async function save(event) {
      event.preventDefault();
      const values = inputs.map((input) => parseCellInput(input.value));
      const wrong = values.findIndex((v, i) => typeof current.values[i] === 'number' && typeof v === 'string' && v !== '');
      if (wrong !== -1) return showError(error, new Error(`"${current.columns[wrong]}" phải là số, ví dụ 1.250.000`));
      const button = event.submitter;
      button.disabled = true;
      try {
        await api(`/api/admin/payslips/${current.period}/${employee.login_id}`, { method: 'PUT', body: { values } });
        current.values = values;
        if (periodSlips && current.period === employeePeriod) periodSlips.byId.set(employee.login_id, values);
        editing = false;
        saved = true;
        render();
        renderEmployees();
      } catch (err) {
        button.disabled = false;
        if (err.status === 401) return show('login-view');
        showError(error, err);
      }
    }

    const rows = current.columns.map((label, i) => {
      const value = current.values[i];
      let cell;
      if (editing) {
        const input = el('input', {
          type: 'text',
          value: typeof value === 'number' ? formatValue(value) : value,
          inputMode: typeof value === 'number' ? 'decimal' : 'text',
          'aria-label': label,
        });
        inputs.push(input);
        cell = el('td', {}, input);
      } else {
        cell = el('td', { class: 'num' }, formatValue(value));
      }
      return el('tr', { class: i === net ? 'net-row' : '' }, el('th', {}, label), cell);
    });

    const periodSelect = el(
      'select',
      {
        class: 'w-240',
        disabled: editing,
        onchange: (e) => {
          current = payslips.find((p) => p.period === e.target.value);
          saved = false;
          render();
        },
      },
      payslips.map((p) => el('option', { value: p.period }, formatPeriod(p.period))),
    );
    periodSelect.value = current.period;

    card.replaceChildren(
      el(
        'form',
        { onsubmit: save, novalidate: true },
        head,
        el('label', {}, 'Kỳ lương'),
        periodSelect,
        saved ? el('p', { class: 'success mt-12' }, 'Đã lưu. Nhân viên thấy số mới ngay khi tải lại trang.') : null,
        !editing && net !== -1
          ? el('div', { class: 'net mt-12' }, el('div', { class: 'label' }, `${current.columns[net]} · ${formatPeriod(current.period)}`), el('div', { class: 'value' }, money(current.values[net])))
          : null,
        editing ? el('p', { class: 'notice mt-12' }, 'Sửa số rồi bấm Lưu. Web không tự tính lại các ô khác (ví dụ Thực lãnh), hãy sửa luôn nếu cần.') : null,
        el('div', { class: 'table-scroll mt-12' }, el('table', { class: 'detail' }, el('tbody', {}, rows))),
        error,
        el(
          'div',
          { class: 'row-actions' },
          editing
            ? [
                el('button', { class: 'primary', type: 'submit' }, 'Lưu thay đổi'),
                el('button', { class: 'ghost', type: 'button', onclick: () => ((editing = false), render()) }, 'Huỷ'),
              ]
            : [
                el('button', { class: 'primary', type: 'button', onclick: () => ((editing = true), (saved = false), render()) }, 'Chỉnh sửa'),
                closeButton(),
              ],
        ),
      ),
    );
    if (editing) inputs[0]?.focus({ preventScroll: true });
  }
  render();
}

// Khung đổi mật khẩu nhân viên: admin tự đặt (chọn sẵn), hoặc đưa về 6 số cuối CCCD
function resetPassword(employee) {
  const who = employee.name || employee.login_id;
  const card = $('code-card');
  const input = el('input', { type: 'password', autocomplete: 'new-password', placeholder: 'Ít nhất 6 ký tự' });
  const customWrap = el(
    'div',
    {},
    el('div', { class: 'password' }, input, el('button', { type: 'button', 'aria-label': 'Hiện mật khẩu', 'aria-pressed': 'false' }, 'Hiện')),
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
        body: custom ? { password: input.value } : {},
      });
      const text = result.custom
        ? `Đã đặt mật khẩu mới cho ${who} (CCCD ${employee.login_id}). Hãy gửi mật khẩu này cho người đó.`
        : `Đã đưa mật khẩu của ${who} (CCCD ${employee.login_id}) về 6 số cuối số CCCD.`;
      card.replaceChildren(el('p', { class: 'success' }, text));
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
      el('h2', {}, `Đổi mật khẩu: ${who}`),
      el('p', { class: 'muted' }, `Số CCCD ${employee.login_id}. Mật khẩu cũ sẽ không dùng được nữa.`),
      modeRadio('custom', 'Mật khẩu do admin đặt', true),
      customWrap,
      modeRadio('cccd', 'Đưa về mặc định: 6 số cuối số CCCD', false),
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
  input.focus({ preventScroll: true });
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
