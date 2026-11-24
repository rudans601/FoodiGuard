// Local-only verification against the running API and Docker PostgreSQL.
// Creates one synthetic account and removes both its account and withdrawal record.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';

import { pool } from '../server/db.js';

const baseUrl = process.env.IRB_TEST_API_URL || 'http://127.0.0.1:18080/api';
const nonce = crypto.randomBytes(6).toString('hex');
const email = `irb-flow-${nonce}@example.test`;
let participantNumber;
let userId;
const receiptIds = [];

async function request(path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function count(table) {
  const result = await pool.query(`SELECT COUNT(*)::int AS count FROM ${table} WHERE user_id = $1`, [userId]);
  return result.rows[0].count;
}

try {
  const docs = await request('/consents');
  assert.equal(docs.status, 200);
  const agreements = docs.body.documents.filter((document) => document.required)
    .map(({ type, version }) => ({ type, version }));
  const privacyText = JSON.stringify(docs.body.documents.find((document) => document.type === 'PRIVACY'));
  assert.match(privacyText, /2026\.12\.4~2027\.12\.3/);
  assert.match(privacyText, /2030\.12\.3/);

  const year = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  const signup = { name: 'IRB 시험 계정', email, password: `test-${nonce}`, birthDate: `${year - 20}-01-01` };
  const explanation = await request('/research-consent');
  assert.equal(explanation.status, 200);
  assert.match(explanation.body.document.text, /2026년 12월 4일부터 2027년 12월 3일/);
  assert.match(explanation.body.document.text, /2030년 12월 3일까지/);
  const declined = await request('/research-consent', { method: 'POST', body: {
    version: explanation.body.document.version, contentHash: explanation.body.document.contentHash,
    adultConfirmed: true, agreed: false,
  } });
  assert.equal(declined.status, 400);
  const agree = async () => {
    const response = await request('/research-consent', { method: 'POST', body: {
      version: explanation.body.document.version, contentHash: explanation.body.document.contentHash,
      adultConfirmed: true, agreed: true,
    } });
    assert.equal(response.status, 201);
    receiptIds.push(response.body.receiptId);
    assert.match(response.body.participantNumber, /^FG-\d{4}$/);
    assert.equal(response.body.agreed, true);
    return response.body;
  };
  const firstReceipt = await agree();
  const researchConsentReceiptId = firstReceipt.receiptId;
  participantNumber = firstReceipt.participantNumber;
  const refused = await request('/auth/signup', { method: 'POST', body: signup });
  assert.equal(refused.status, 400);
  assert.equal(refused.body.code, 'CONSENT_PAYLOAD_INVALID');
  const underage = await request('/auth/signup', { method: 'POST', body: { ...signup, birthDate: `${year - 18}-01-01`, agreements } });
  assert.equal(underage.status, 403);
  assert.equal(underage.body.code, 'AGE_NOT_ELIGIBLE');
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE email = $1', [email])).rows[0].count, 0);

  const bypass = await request('/auth/signup', { method: 'POST', body: { ...signup, agreements } });
  assert.equal(bypass.status, 403);
  assert.equal(bypass.body.code, 'RESEARCH_CONSENT_REQUIRED');

  const created = await request('/auth/signup', { method: 'POST', body: { ...signup, agreements, researchConsentReceiptId } });
  assert.equal(created.status, 201);
  assert.equal(created.body.user.participantNumber, participantNumber);
  assert.equal(created.body.user.consent.completed, true);
  userId = created.body.user.id;
  const token = created.body.token;

  const saved = await pool.query('SELECT consent_type, consent_version, content_hash, consented_at FROM user_consents WHERE user_id = $1', [userId]);
  assert.equal(saved.rows.length, agreements.length);
  for (const row of saved.rows) {
    const document = docs.body.documents.find((item) => item.type === row.consent_type);
    assert.equal(row.consent_version, document.version);
    assert.equal(row.content_hash, document.contentHash);
    assert.ok(row.consented_at);
  }
  const researchRecord = await pool.query('SELECT document_version, content_hash, agreed, consented_at, used_at, participant_number FROM research_consents WHERE id = $1', [researchConsentReceiptId]);
  assert.equal(researchRecord.rows[0].document_version, explanation.body.document.version);
  assert.equal(researchRecord.rows[0].content_hash.trim(), explanation.body.document.contentHash);
  assert.equal(researchRecord.rows[0].participant_number, participantNumber);
  assert.equal(researchRecord.rows[0].agreed, true);
  assert.ok(researchRecord.rows[0].consented_at);
  assert.ok(researchRecord.rows[0].used_at);

  const secondReceipt = await agree();
  assert.notEqual(secondReceipt.participantNumber, participantNumber);
  const forged = await request('/auth/signup', { method: 'POST', body: { ...signup, email: `other-${nonce}@example.test`, participantNumber, agreements, researchConsentReceiptId: secondReceipt.receiptId } });
  assert.equal(forged.status, 400);
  assert.equal(forged.body.code, 'PARTICIPANT_NUMBER_MISMATCH');
  const me = await request('/auth/me', { token });
  assert.equal(me.status, 200);
  assert.equal(me.body.user.participantNumber, participantNumber);

  const profile = await request(`/auth/users/${userId}/profile`, {
    method: 'PATCH', token,
    body: {
      gender: '녀', birthDate: signup.birthDate, height: '165.00', weight: '60.00',
      activityLevel: '운동 거의 안함', dietaryGoal: '체중 유지 목표', allergies: ['우유'],
    },
  });
  assert.equal(profile.status, 200);
  assert.equal(await count('user_profiles'), 1);
  assert.equal(await count('user_allergies'), 1);

  const beforeWithdrawal = Date.now();
  const withdrawn = await request(`/auth/users/${userId}`, { method: 'DELETE', token });
  const afterWithdrawal = Date.now();
  assert.equal(withdrawn.status, 204);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM users WHERE id = $1', [userId])).rows[0].count, 0);
  for (const table of ['user_profiles', 'user_allergies', 'user_consents']) assert.equal(await count(table), 0);
  const record = await pool.query('SELECT participant_number, withdrawn_at FROM participant_withdrawals WHERE participant_number = $1', [participantNumber]);
  assert.equal(record.rows.length, 1);
  assert.equal(record.rows[0].participant_number, participantNumber);
  const consentAfterWithdrawal = await pool.query('SELECT agreed, withdrawn_at FROM research_consents WHERE id = $1', [researchConsentReceiptId]);
  assert.equal(consentAfterWithdrawal.rows[0].agreed, false);
  assert.ok(consentAfterWithdrawal.rows[0].withdrawn_at);
  const withdrawnAt = new Date(record.rows[0].withdrawn_at).getTime();
  assert.ok(withdrawnAt >= beforeWithdrawal - 1000 && withdrawnAt <= afterWithdrawal + 1000);
  const afterDelete = await request('/auth/me', { token });
  assert.equal(afterDelete.status, 404);
  const reused = await request('/auth/signup', { method: 'POST', body: { ...signup, agreements, researchConsentReceiptId } });
  assert.equal(reused.status, 403);
  assert.equal(reused.body.code, 'RESEARCH_CONSENT_REQUIRED');

  process.stdout.write(`${JSON.stringify({ ok: true, checks: [
    'consent dates', 'research explanation', 'research refusal', 'research bypass blocked',
    'age 18 rejected', 'atomic signup',
    'FG issued on consent and unique', 'consent version/hash/server time', 'profile linkage',
    'withdrawal cascades', 'FG and withdrawal server time', 'old session rejected', 'receipt reuse rejected',
  ] })}\n`);
} finally {
  if (userId) await pool.query('DELETE FROM users WHERE id = $1', [userId]).catch(() => {});
  if (participantNumber) await pool.query('DELETE FROM participant_withdrawals WHERE participant_number = $1', [participantNumber]).catch(() => {});
  for (const receiptId of receiptIds) await pool.query('DELETE FROM research_consents WHERE id = $1', [receiptId]).catch(() => {});
  await pool.end().catch(() => {});
}
