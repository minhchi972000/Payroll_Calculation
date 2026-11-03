import assert from 'node:assert/strict';
import test from 'node:test';
import { generateCode, hashInitialCode, hashPassword, verifyPassword } from '../src/auth.js';
import { buildAssertion, fillMerges, parseSheetUrl } from '../src/gsheet.js';

test('mật khẩu PBKDF2', async () => {
  const hash = await hashPassword('matkhau123');
  assert.match(hash, /^pbkdf2\$30000\$/);
  assert.ok(await verifyPassword('matkhau123', hash));
  assert.ok(!(await verifyPassword('matkhau124', hash)));
});

test('mã ban đầu', async () => {
  const code = generateCode();
  assert.match(code, /^\d{8}$/);
  const hash = await hashInitialCode(code);
  assert.ok(await verifyPassword(code, hash));
  assert.ok(!(await verifyPassword('00000000', hash)) || code === '00000000');
  assert.ok(!(await verifyPassword(code, 'rác')));
});

test('link Google Sheet', () => {
  assert.deepEqual(parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC-_x/edit#gid=123'), { id: '1AbC-_x', gid: '123' });
  assert.deepEqual(parseSheetUrl('https://docs.google.com/spreadsheets/d/1AbC/edit'), { id: '1AbC', gid: null });
  assert.equal(parseSheetUrl('https://example.com'), null);
});

test('điền ô gộp từ Google Sheet', () => {
  const rows = [['Họ tên', 'Khấu trừ', '', 'Lương'], ['', 'BHXH', 'Thuế']];
  fillMerges(rows, [{ endRowIndex: 2, startColumnIndex: 0, endColumnIndex: 1 }, { startRowIndex: 0, endRowIndex: 1, startColumnIndex: 1, endColumnIndex: 3 }]);
  assert.deepEqual(rows, [['Họ tên', 'Khấu trừ', 'Khấu trừ', 'Lương'], ['Họ tên', 'BHXH', 'Thuế']]);
});

test('JWT service account ký đúng RS256', async () => {
  const { publicKey, privateKey } = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  );
  const der = Buffer.from(await crypto.subtle.exportKey('pkcs8', privateKey)).toString('base64');
  const pem = `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join('\n')}\n-----END PRIVATE KEY-----\n`;
  const jwt = await buildAssertion({ client_email: 'sa@x.iam.gserviceaccount.com', private_key: pem }, 1000);
  const [h, c, s] = jwt.split('.');
  const claims = JSON.parse(Buffer.from(c, 'base64url').toString());
  assert.equal(claims.iss, 'sa@x.iam.gserviceaccount.com');
  assert.equal(claims.exp, 4600);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', publicKey, Buffer.from(s, 'base64url'), new TextEncoder().encode(`${h}.${c}`));
  assert.ok(ok);
});
