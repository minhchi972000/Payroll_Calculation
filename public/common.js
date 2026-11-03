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

export function showError(container, err) {
  container.textContent = err ? err.message || String(err) : '';
  container.hidden = !err;
}
