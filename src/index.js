import {
  ADMIN_COOKIE,
  ADMIN_SESSION_SECONDS,
  EMPLOYEE_COOKIE,
  EMPLOYEE_SESSION_SECONDS,
  clearCookie,
  clearFailures,
  createSession,
  deleteSession,
  getSession,
  hashInitialCode,
  initialPassword,
  hashPassword,
  isRateLimited,
  now,
  recordFailure,
  safeEqual,
  sessionCookie,
  verifyPassword,
} from './auth.js';
import { fetchSheetRows, readServiceAccount } from './gsheet.js';
import { isValidPeriod, normalizeLoginId, parsePayrollTable } from './parse.js';

const LOGIN_WINDOW_SECONDS = 15 * 60;
const MAX_FAILS_PER_ID = 5;
const MAX_FAILS_PER_IP = 100;
const MIN_PASSWORD_LENGTH = 6;
const MAX_IMPORT_ROWS = 5000;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });
}

async function readJson(request) {
  if (!(request.headers.get('Content-Type') || '').includes('application/json')) {
    throw new HttpError(415, 'Yêu cầu không hợp lệ.');
  }
  try {
    return await request.json();
  } catch {
    throw new HttpError(400, 'Dữ liệu gửi lên không hợp lệ.');
  }
}

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || 'local';
}

// Chặn request ghi dữ liệu đến từ trang web khác (CSRF)
function checkOrigin(request) {
  if (request.method === 'GET') return;
  const origin = request.headers.get('Origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'Không được phép.');
}

async function requireEmployee(request, env) {
  const session = await getSession(env.DB, request, 'employee');
  if (!session) throw new HttpError(401, 'Bạn chưa đăng nhập.');
  const employee = await env.DB.prepare('SELECT login_id, name FROM employees WHERE login_id = ?')
    .bind(session.subject)
    .first();
  if (!employee) throw new HttpError(401, 'Tài khoản không còn tồn tại.');
  return employee;
}

async function requireAdmin(request, env) {
  const session = await getSession(env.DB, request, 'admin');
  if (!session) throw new HttpError(401, 'Bạn chưa đăng nhập admin.');
}

function validatePassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new HttpError(400, `Mật khẩu mới phải có ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`);
  }
  if (password.length > 128) throw new HttpError(400, 'Mật khẩu quá dài.');
}

// ---------- Nhân viên ----------

async function login(request, env) {
  const body = await readJson(request);
  const password = String(body.password ?? '');
  // Admin cũng đăng nhập được ở trang này, bằng tài khoản admin thay cho số CCCD
  if (env.ADMIN_USERNAME && (await safeEqual(String(body.loginId ?? '').trim(), env.ADMIN_USERNAME.trim()))) {
    return adminSignIn(request, env, body.loginId, password);
  }

  const loginId = normalizeLoginId(body.loginId);
  const ipKey = `ip:${clientIp(request)}`;
  const idKey = `id:${loginId}`;
  if (!loginId) throw new HttpError(400, 'Số CCCD phải có đủ 12 chữ số.');
  if (!password) throw new HttpError(400, 'Vui lòng nhập mật khẩu.');

  if ((await isRateLimited(env.DB, ipKey, MAX_FAILS_PER_IP)) || (await isRateLimited(env.DB, idKey, MAX_FAILS_PER_ID))) {
    throw new HttpError(429, 'Bạn đã nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.');
  }

  const employee = await env.DB.prepare('SELECT login_id, password_hash FROM employees WHERE login_id = ?')
    .bind(loginId)
    .first();
  if (!employee || !(await verifyPassword(password, employee.password_hash))) {
    await Promise.all([recordFailure(env.DB, ipKey, LOGIN_WINDOW_SECONDS), recordFailure(env.DB, idKey, LOGIN_WINDOW_SECONDS)]);
    throw new HttpError(401, 'Số CCCD hoặc mật khẩu không đúng.');
  }

  await clearFailures(env.DB, idKey);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()),
    env.DB.prepare('UPDATE employees SET last_login_at = ? WHERE login_id = ?').bind(now(), loginId),
  ]);
  const token = await createSession(env.DB, 'employee', loginId, EMPLOYEE_SESSION_SECONDS);
  return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(EMPLOYEE_COOKIE, token, EMPLOYEE_SESSION_SECONDS) });
}

async function logout(request, env) {
  await deleteSession(env.DB, request, 'employee');
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(EMPLOYEE_COOKIE) });
}

async function me(request, env) {
  const employee = await requireEmployee(request, env);
  const { results } = await env.DB.prepare('SELECT period FROM payslips WHERE login_id = ? ORDER BY period DESC')
    .bind(employee.login_id)
    .all();
  return json({
    loginId: employee.login_id,
    name: employee.name,
    periods: results.map((r) => r.period),
  });
}

async function payslip(request, env, url) {
  const employee = await requireEmployee(request, env);
  const period = url.searchParams.get('period');
  if (!isValidPeriod(period)) throw new HttpError(400, 'Kỳ lương không hợp lệ.');

  // Luôn lọc theo tài khoản trong phiên đăng nhập, không bao giờ theo tham số từ trình duyệt
  const row = await env.DB.prepare(
    `SELECT p.name, p."values" AS vals, d.columns FROM payslips p JOIN periods d ON d.period = p.period
     WHERE p.period = ? AND p.login_id = ?`,
  )
    .bind(period, employee.login_id)
    .first();
  if (!row) throw new HttpError(404, 'Không có bảng lương cho kỳ này.');

  const columns = JSON.parse(row.columns);
  const values = JSON.parse(row.vals);
  return json({
    period,
    name: row.name || employee.name,
    loginId: employee.login_id,
    items: columns.map((label, i) => ({ label, value: values[i] ?? '' })),
  });
}

// ---------- Admin ----------

async function adminLogin(request, env) {
  const body = await readJson(request);
  return adminSignIn(request, env, body.username, body.password);
}

// Dùng cho cả trang /admin và trang đăng nhập chung
async function adminSignIn(request, env, username, password) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) {
    throw new HttpError(503, 'Chưa cấu hình tài khoản admin (ADMIN_USERNAME và ADMIN_PASSWORD).');
  }
  const ipKey = `admin-ip:${clientIp(request)}`;
  if (await isRateLimited(env.DB, ipKey, MAX_FAILS_PER_ID)) {
    throw new HttpError(429, 'Nhập sai quá nhiều lần. Vui lòng thử lại sau 15 phút.');
  }
  // Luôn so cả hai để không lộ ra là sai tài khoản hay sai mật khẩu
  const [usernameOk, passwordOk] = await Promise.all([
    safeEqual(String(username ?? '').trim(), env.ADMIN_USERNAME.trim()),
    safeEqual(String(password ?? ''), env.ADMIN_PASSWORD),
  ]);
  if (!usernameOk || !passwordOk) {
    await recordFailure(env.DB, ipKey, LOGIN_WINDOW_SECONDS);
    throw new HttpError(401, 'Tài khoản hoặc mật khẩu không đúng.');
  }
  await clearFailures(env.DB, ipKey);
  const token = await createSession(env.DB, 'admin', 'admin', ADMIN_SESSION_SECONDS);
  return json({ ok: true, admin: true }, 200, { 'Set-Cookie': sessionCookie(ADMIN_COOKIE, token, ADMIN_SESSION_SECONDS) });
}

async function adminLogout(request, env) {
  await deleteSession(env.DB, request, 'admin');
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(ADMIN_COOKIE) });
}

async function adminMe(request, env) {
  await requireAdmin(request, env);
  const sa = readServiceAccount(env);
  return json({ googleServiceAccount: sa ? sa.client_email : null });
}

async function adminImport(request, env) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const period = body.period;
  if (!isValidPeriod(period)) throw new HttpError(400, 'Vui lòng chọn tháng lương.');

  let rows;
  let source;
  if (body.source === 'gsheet') {
    const sa = readServiceAccount(env);
    if (!sa) throw new HttpError(400, 'Chưa cấu hình Google service account (GOOGLE_SERVICE_ACCOUNT_JSON).');
    try {
      const sheet = await fetchSheetRows(sa, body.sheetUrl);
      rows = sheet.rows;
      source = `Google Sheet (tab ${sheet.tab})`;
    } catch (err) {
      throw new HttpError(400, err.message);
    }
  } else {
    rows = body.rows;
    source = typeof body.fileName === 'string' ? body.fileName.slice(0, 200) : 'Excel';
  }
  if (!Array.isArray(rows) || rows.length > MAX_IMPORT_ROWS) throw new HttpError(400, 'Dữ liệu bảng lương không hợp lệ hoặc quá lớn.');

  const parsed = parsePayrollTable(rows);
  const ids = parsed.records.map((r) => r.loginId);
  const existingIds = new Set();
  // D1 giới hạn 100 tham số mỗi câu lệnh
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    const { results } = await env.DB.prepare(`SELECT login_id FROM employees WHERE login_id IN (${chunk.map(() => '?').join(',')})`)
      .bind(...chunk)
      .all();
    results.forEach((r) => existingIds.add(r.login_id));
  }
  const existingPeriod = await env.DB.prepare('SELECT COUNT(*) AS n FROM payslips WHERE period = ?').bind(period).first();
  const newRecords = parsed.records.filter((r) => !existingIds.has(r.loginId));

  const summary = {
    period,
    source,
    idLabel: parsed.idLabel,
    columns: parsed.columns,
    rowCount: parsed.records.length,
    newEmployeeCount: newRecords.length,
    replacesExisting: existingPeriod.n,
    errors: parsed.errors,
    warnings: parsed.warnings,
    preview: parsed.records.slice(0, 3),
  };
  if (body.dryRun || parsed.errors.length > 0) return json({ ...summary, imported: false });

  const t = now();
  const newAccounts = [];
  const statements = [
    env.DB.prepare('DELETE FROM payslips WHERE period = ?').bind(period),
    env.DB.prepare(
      `INSERT INTO periods (period, columns, source, imported_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(period) DO UPDATE SET columns = excluded.columns, source = excluded.source, imported_at = excluded.imported_at`,
    ).bind(period, JSON.stringify(parsed.columns), source, t),
  ];
  for (const r of parsed.records) {
    statements.push(
      env.DB.prepare('INSERT INTO payslips (period, login_id, name, "values") VALUES (?, ?, ?, ?)').bind(
        period,
        r.loginId,
        r.name,
        JSON.stringify(r.values),
      ),
    );
    if (existingIds.has(r.loginId)) {
      if (r.name) {
        statements.push(env.DB.prepare('UPDATE employees SET name = ?, updated_at = ? WHERE login_id = ?').bind(r.name, t, r.loginId));
      }
    } else {
      newAccounts.push({ loginId: r.loginId, name: r.name });
      statements.push(
        env.DB.prepare(
          'INSERT INTO employees (login_id, name, password_hash, default_password, created_at, updated_at) VALUES (?, ?, ?, 1, ?, ?)',
        ).bind(r.loginId, r.name, await hashInitialCode(initialPassword(r.loginId)), t, t),
      );
    }
  }
  // batch chạy trong một transaction: lỗi giữa chừng thì không có gì bị ghi
  await env.DB.batch(statements);
  return json({ ...summary, imported: true, newAccounts });
}

async function adminPeriods(request, env) {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT d.period, d.source, d.imported_at, COUNT(p.login_id) AS count
     FROM periods d LEFT JOIN payslips p ON p.period = d.period GROUP BY d.period ORDER BY d.period DESC`,
  ).all();
  return json({ periods: results });
}

// Toàn bộ bảng lương một kỳ, theo đúng thứ tự dòng trong file đã nhập, để trang admin xuất ra Excel
async function adminExportPeriod(request, env, period) {
  await requireAdmin(request, env);
  if (!isValidPeriod(period)) throw new HttpError(400, 'Kỳ lương không hợp lệ.');
  const info = await env.DB.prepare('SELECT columns FROM periods WHERE period = ?').bind(period).first();
  if (!info) throw new HttpError(404, 'Không có kỳ lương này.');
  const { results } = await env.DB.prepare('SELECT login_id, name, "values" AS vals FROM payslips WHERE period = ? ORDER BY rowid')
    .bind(period)
    .all();
  return json({
    period,
    columns: JSON.parse(info.columns),
    rows: results.map((r) => ({ loginId: r.login_id, name: r.name, values: JSON.parse(r.vals) })),
  });
}

// Mọi phiếu lương của một nhân viên (mới nhất trước), để admin xem chi tiết và sửa
async function adminEmployeePayslips(request, env, loginId) {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    `SELECT p.period, p.name, p."values" AS vals, d.columns FROM payslips p JOIN periods d ON d.period = p.period
     WHERE p.login_id = ? ORDER BY p.period DESC`,
  )
    .bind(loginId)
    .all();
  return json({
    loginId,
    payslips: results.map((r) => ({ period: r.period, name: r.name, columns: JSON.parse(r.columns), values: JSON.parse(r.vals) })),
  });
}

// Admin sửa giá trị một phiếu lương. Mỗi ô là số, chữ (tối đa 500 ký tự) hoặc để trống; số ô phải khớp số cột của kỳ.
async function adminUpdatePayslip(request, env, period, loginId) {
  await requireAdmin(request, env);
  const body = await readJson(request);
  const info = await env.DB.prepare('SELECT columns FROM periods WHERE period = ?').bind(period).first();
  if (!info) throw new HttpError(404, 'Không có kỳ lương này.');
  const columns = JSON.parse(info.columns);
  const values = body.values;
  if (!Array.isArray(values) || values.length !== columns.length) throw new HttpError(400, 'Dữ liệu phiếu lương không khớp số cột.');
  values.forEach((v, i) => {
    const ok = (typeof v === 'number' && Number.isFinite(v)) || (typeof v === 'string' && v.length <= 500);
    if (!ok) throw new HttpError(400, `Giá trị ở mục "${columns[i]}" không hợp lệ.`);
  });
  const result = await env.DB.prepare('UPDATE payslips SET "values" = ? WHERE period = ? AND login_id = ?')
    .bind(JSON.stringify(values), period, loginId)
    .run();
  if (!result.meta.changes) throw new HttpError(404, 'Không tìm thấy phiếu lương này.');
  return json({ ok: true });
}

async function adminDeletePeriod(request, env, period) {
  await requireAdmin(request, env);
  if (!isValidPeriod(period)) throw new HttpError(400, 'Kỳ lương không hợp lệ.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM payslips WHERE period = ?').bind(period),
    env.DB.prepare('DELETE FROM periods WHERE period = ?').bind(period),
  ]);
  return json({ ok: true });
}

async function adminEmployees(request, env) {
  await requireAdmin(request, env);
  const { results } = await env.DB.prepare(
    'SELECT login_id, name, default_password, last_login_at, created_at FROM employees ORDER BY name COLLATE NOCASE, login_id',
  ).all();
  return json({ employees: results });
}

// Chỉ admin đổi được mật khẩu nhân viên. Không gửi mật khẩu: đưa về mặc định (6 số cuối CCCD).
// Có mật khẩu: dùng mật khẩu admin đặt.
async function adminResetPassword(request, env, loginId) {
  await requireAdmin(request, env);
  const employee = await env.DB.prepare('SELECT login_id, name FROM employees WHERE login_id = ?').bind(loginId).first();
  if (!employee) throw new HttpError(404, 'Không tìm thấy nhân viên.');
  const body = (request.headers.get('Content-Type') || '').includes('application/json') ? await readJson(request) : {};
  const custom = body.password !== undefined && body.password !== '';
  if (custom) validatePassword(body.password);
  const hash = custom ? await hashPassword(body.password) : await hashInitialCode(initialPassword(loginId));
  await env.DB.batch([
    env.DB.prepare('UPDATE employees SET password_hash = ?, default_password = ?, updated_at = ? WHERE login_id = ?').bind(
      hash,
      custom ? 0 : 1,
      now(),
      loginId,
    ),
    env.DB.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").bind(loginId),
    env.DB.prepare('DELETE FROM rate_limits WHERE key = ?').bind(`id:${loginId}`),
  ]);
  return json({ loginId, name: employee.name, custom });
}

async function adminDeleteEmployee(request, env, loginId) {
  await requireAdmin(request, env);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM payslips WHERE login_id = ?').bind(loginId),
    env.DB.prepare("DELETE FROM sessions WHERE kind = 'employee' AND subject = ?").bind(loginId),
    env.DB.prepare('DELETE FROM employees WHERE login_id = ?').bind(loginId),
  ]);
  return json({ ok: true });
}

// ---------- Router ----------

async function route(request, env, url) {
  const { pathname } = url;
  const method = request.method;
  checkOrigin(request);

  if (pathname === '/api/login' && method === 'POST') return login(request, env);
  if (pathname === '/api/logout' && method === 'POST') return logout(request, env);
  if (pathname === '/api/me' && method === 'GET') return me(request, env);
  if (pathname === '/api/payslip' && method === 'GET') return payslip(request, env, url);

  if (pathname === '/api/admin/login' && method === 'POST') return adminLogin(request, env);
  if (pathname === '/api/admin/logout' && method === 'POST') return adminLogout(request, env);
  if (pathname === '/api/admin/me' && method === 'GET') return adminMe(request, env);
  if (pathname === '/api/admin/import' && method === 'POST') return adminImport(request, env);
  if (pathname === '/api/admin/periods' && method === 'GET') return adminPeriods(request, env);
  if (pathname === '/api/admin/employees' && method === 'GET') return adminEmployees(request, env);

  let m = pathname.match(/^\/api\/admin\/periods\/(\d{4}-\d{2})\/export$/);
  if (m && method === 'GET') return adminExportPeriod(request, env, m[1]);
  m = pathname.match(/^\/api\/admin\/periods\/(\d{4}-\d{2})$/);
  if (m && method === 'DELETE') return adminDeletePeriod(request, env, m[1]);
  // Tài khoản nhân viên là số CCCD 12 chữ số. Vẫn nhận SĐT 10 số để quản lý tài khoản tạo từ bản cũ.
  m = pathname.match(/^\/api\/admin\/employees\/(0\d{9}|0\d{11})\/reset$/);
  if (m && method === 'POST') return adminResetPassword(request, env, m[1]);
  m = pathname.match(/^\/api\/admin\/employees\/(0\d{9}|0\d{11})\/payslips$/);
  if (m && method === 'GET') return adminEmployeePayslips(request, env, m[1]);
  m = pathname.match(/^\/api\/admin\/payslips\/(\d{4}-\d{2})\/(0\d{9}|0\d{11})$/);
  if (m && method === 'PUT') return adminUpdatePayslip(request, env, m[1], m[2]);
  m = pathname.match(/^\/api\/admin\/employees\/(0\d{9}|0\d{11})$/);
  if (m && method === 'DELETE') return adminDeleteEmployee(request, env, m[1]);

  throw new HttpError(404, 'Không tìm thấy.');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    try {
      return await route(request, env, url);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, err.status);
      console.error(err);
      return json({ error: 'Lỗi hệ thống, vui lòng thử lại.' }, 500);
    }
  },
};
