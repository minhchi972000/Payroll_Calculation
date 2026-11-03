// Tiện ích dùng chung cho trang nhân viên và trang admin

export async function api(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  let data = {};
  try {
    data = await res.json();
  } catch {
    // phản hồi không phải JSON
  }
  if (!res.ok) {
    const err = new Error(data.error || `Lỗi ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const numberFormat = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });

export function formatValue(value) {
  if (typeof value === 'number') return numberFormat.format(value);
  return value === '' || value === null || value === undefined ? '—' : String(value);
}

export function formatPeriod(period) {
  const [y, m] = period.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

export function formatDateTime(seconds) {
  if (!seconds) return '—';
  return new Date(seconds * 1000).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' });
}

export function normalizeLabel(text) {
  return String(text)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase();
}

const NET_PAY = /thuc (linh|lanh|nhan)|luong net|net pay|so tien (nhan|thuc nhan)|con (linh|nhan)/;

// Vị trí cột "Thực lãnh" / "Thực nhận" (lấy cột cuối cùng khớp), -1 nếu không có
export function netPayIndex(labels) {
  for (let i = labels.length - 1; i >= 0; i--) if (NET_PAY.test(normalizeLabel(labels[i]))) return i;
  return -1;
}

// Tạo phần tử DOM; nội dung luôn gán qua textContent nên dữ liệu từ Excel không chèn được HTML
export function el(tag, props = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key in node) node[key] = value;
    else node.setAttribute(key, value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return node;
}

// Nút "Hiện" cạnh ô mật khẩu (<div class="password"><input><button>), giúp gõ mã trên điện thoại khỏi sai
function setPasswordVisible(wrap, visible) {
  const button = wrap.querySelector('button');
  wrap.querySelector('input').type = visible ? 'text' : 'password';
  button.textContent = visible ? 'Ẩn' : 'Hiện';
  button.setAttribute('aria-pressed', String(visible));
}

export function hidePasswords() {
  document.querySelectorAll('.password').forEach((wrap) => setPasswordVisible(wrap, false));
}

export function initPasswordToggles(root = document) {
  root.querySelectorAll('.password').forEach((wrap) => {
    wrap.querySelector('button').addEventListener('click', () => {
      setPasswordVisible(wrap, wrap.querySelector('input').type === 'password');
    });
  });
}

export function showError(container, err) {
  container.textContent = err ? err.message || String(err) : '';
  container.hidden = !err;
}

// Bản demo (địa chỉ có chữ "demo") hiện dải cảnh báo để không ai nhập bảng lương thật vào đây
if (location.hostname.includes('demo')) {
  document.body.prepend(el('div', { class: 'demo-banner' }, 'BẢN DEMO · dữ liệu giả, không nhập bảng lương thật vào đây'));
}
