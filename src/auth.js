const enc = new TextEncoder();

// Gói Workers miễn phí chỉ cho 10ms CPU mỗi request, 30k vòng PBKDF2 tốn khoảng 3-5ms.
const PBKDF2_ITERATIONS = 30000;

export const EMPLOYEE_SESSION_SECONDS = 30 * 24 * 3600;
export const ADMIN_SESSION_SECONDS = 8 * 3600;
export const EMPLOYEE_COOKIE = 'sid';
export const ADMIN_COOKIE = 'asid';

export const now = () => Math.floor(Date.now() / 1000);

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function toBase64Url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text) {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// So sánh hai chuỗi mà thời gian không phụ thuộc vào vị trí ký tự khác nhau
export async function safeEqual(a, b) {
  const [ha, hb] = await Promise.all([sha256Hex(String(a)), sha256Hex(String(b))]);
  let diff = 0;
  for (let i = 0; i < ha.length; i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}

async function pbkdf2(password, saltHex, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}

function randomSaltHex() {
  return toHex(crypto.getRandomValues(new Uint8Array(16)));
}

// Mật khẩu do nhân viên tự đặt
export async function hashPassword(password) {
  const salt = randomSaltHex();
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${await pbkdf2(password, salt, PBKDF2_ITERATIONS)}`;
}

// Mã ban đầu do hệ thống sinh: dùng SHA-256 cho nhanh, vì một lần nhập có thể tạo hàng trăm mã
// trong cùng một request. Mã này bắt buộc phải đổi ở lần đăng nhập đầu tiên.
export async function hashInitialCode(code) {
  const salt = randomSaltHex();
  return `sha256$${salt}$${await sha256Hex(salt + code)}`;
}

export async function verifyPassword(password, stored) {
  const parts = String(stored).split('$');
  if (parts[0] === 'pbkdf2' && parts.length === 4) {
    return safeEqual(await pbkdf2(password, parts[2], Number(parts[1])), parts[3]);
  }
  if (parts[0] === 'sha256' && parts.length === 3) {
    return safeEqual(await sha256Hex(parts[1] + password), parts[2]);
  }
  return false;
}

export function generateCode() {
  // 8 chữ số, dễ gõ trên điện thoại. Rejection sampling để các chữ số phân bố đều.
  let code = '';
  while (code.length < 8) {
    for (const b of crypto.getRandomValues(new Uint8Array(16))) {
      if (b < 250 && code.length < 8) code += String(b % 10);
    }
  }
  return code;
}

export async function createSession(db, kind, subject, ttlSeconds) {
  const token = toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  await db
    .prepare('INSERT INTO sessions (token_hash, kind, subject, expires_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256Hex(token), kind, subject, now() + ttlSeconds)
    .run();
  return token;
}

export async function getSession(db, request, kind) {
  const token = readCookie(request, kind === 'admin' ? ADMIN_COOKIE : EMPLOYEE_COOKIE);
  if (!token) return null;
  return db
    .prepare('SELECT subject, expires_at FROM sessions WHERE token_hash = ? AND kind = ? AND expires_at > ?')
    .bind(await sha256Hex(token), kind, now())
    .first();
}

export async function deleteSession(db, request, kind) {
  const token = readCookie(request, kind === 'admin' ? ADMIN_COOKIE : EMPLOYEE_COOKIE);
  if (token) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256Hex(token)).run();
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return null;
}

export function sessionCookie(name, token, maxAge) {
  return `${name}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearCookie(name) {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

// Giới hạn số lần thử sai. Trả về true nếu key đang bị khoá.
export async function isRateLimited(db, key, limit) {
  const row = await db.prepare('SELECT count, reset_at FROM rate_limits WHERE key = ?').bind(key).first();
  return Boolean(row && row.reset_at > now() && row.count >= limit);
}

export async function recordFailure(db, key, windowSeconds) {
  const t = now();
  await db
    .prepare(
      `INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
       ON CONFLICT(key) DO UPDATE SET
         count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
         reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END`,
    )
    .bind(key, t + windowSeconds, t)
    .run();
}

export async function clearFailures(db, key) {
  await db.prepare('DELETE FROM rate_limits WHERE key = ?').bind(key).run();
}
