// Đọc Google Sheet riêng tư bằng service account (sheet được share cho email của service account,
// không cần mở "Bất kỳ ai có đường liên kết").

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const enc = new TextEncoder();

function base64UrlEncode(input) {
  const bytes = typeof input === 'string' ? enc.encode(input) : new Uint8Array(input);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function readServiceAccount(env) {
  if (!env.GOOGLE_SERVICE_ACCOUNT_JSON) return null;
  try {
    const sa = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT_JSON);
    return sa.client_email && sa.private_key ? sa : null;
  } catch {
    return null;
  }
}

export function parseSheetUrl(url) {
  const id = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)?.[1];
  const gid = String(url).match(/[#&?]gid=(\d+)/)?.[1];
  return id ? { id, gid: gid ?? null } : null;
}

async function importPrivateKey(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
}

export async function buildAssertion(sa, issuedAt = Math.floor(Date.now() / 1000)) {
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64UrlEncode(
    JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: 'https://oauth2.googleapis.com/token', iat: issuedAt, exp: issuedAt + 3600 }),
  );
  const key = await importPrivateKey(sa.private_key);
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc.encode(`${header}.${claims}`));
  return `${header}.${claims}.${base64UrlEncode(signature)}`;
}

async function getAccessToken(sa) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: await buildAssertion(sa) }),
  });
  if (!res.ok) throw new Error('Google từ chối service account. Kiểm tra lại GOOGLE_SERVICE_ACCOUNT_JSON.');
  return (await res.json()).access_token;
}

async function googleGet(url, token) {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 403 || res.status === 404) {
    throw new Error('Không mở được Google Sheet. Hãy share sheet (quyền Người xem) cho email service account.');
  }
  if (!res.ok) throw new Error(`Google Sheets lỗi ${res.status}.`);
  return res.json();
}

export async function fetchSheetRows(sa, sheetUrl) {
  const parsed = parseSheetUrl(sheetUrl);
  if (!parsed) throw new Error('Link Google Sheet không đúng định dạng.');
  const token = await getAccessToken(sa);
  const base = `https://sheets.googleapis.com/v4/spreadsheets/${parsed.id}`;

  // Không có gid thì lấy tab đầu tiên
  const meta = await googleGet(`${base}?fields=sheets(properties(sheetId,title),merges)`, token);
  const sheets = meta.sheets || [];
  const sheet = parsed.gid === null ? sheets[0] : sheets.find((s) => String(s.properties.sheetId) === parsed.gid);
  if (!sheet) throw new Error('Không tìm thấy tab trong Google Sheet.');

  const range = encodeURIComponent(`'${sheet.properties.title.replace(/'/g, "''")}'`);
  const data = await googleGet(
    `${base}/values/${range}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
    token,
  );
  return { rows: fillMerges(data.values || [], sheet.merges || []), tab: sheet.properties.title };
}

// API chỉ trả giá trị ở ô trên cùng bên trái của vùng gộp, điền nó vào các ô còn lại
export function fillMerges(rows, merges) {
  for (const m of merges) {
    // JSON của Google bỏ qua trường có giá trị 0
    const r0 = m.startRowIndex ?? 0;
    const c0 = m.startColumnIndex ?? 0;
    const value = rows[r0]?.[c0];
    if (value === undefined) continue;
    for (let r = r0; r < Math.min(m.endRowIndex, rows.length); r++) {
      for (let c = c0; c < m.endColumnIndex; c++) {
        while (rows[r].length < c) rows[r].push('');
        rows[r][c] = value;
      }
    }
  }
  return rows;
}
