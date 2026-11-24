import assert from 'node:assert/strict';
import test from 'node:test';

import { PGlite } from '@electric-sql/pglite';

import { ensureAuthSchema, signupUser, withdrawUser } from './auth.js';
import { assertAiConsent, consentContentHash, grantAiConsent, publicConsentDocuments, withdrawAiConsent } from './consents.js';
import { publicResearchConsentDocument, recordResearchConsent } from './researchConsent.js';

test('IRB 가입은 성인·FG 번호·필수 동의가 있어야만 저장되고 철회 시 계정을 지운다', async () => {
  const db = new PGlite();
  const query = db.query.bind(db);
  const pool = { query, async connect() { return { query, release() {} }; } };
  const documents = publicConsentDocuments();
  const agreements = documents.filter((document) => document.required)
    .map(({ type, version }) => ({ type, version }));
  const kstYear = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', year: 'numeric' }).format(new Date()));
  const adultBirthDate = `${kstYear - 20}-01-01`;
  const underageBirthDate = `${kstYear - 18}-01-01`;
  const base = { name: 'IRB 시험', email: 'irb-flow@example.test', password: 'sample-password', birthDate: adultBirthDate };

  try {
    await ensureAuthSchema(pool);

    const explanation = publicResearchConsentDocument();
    await assert.rejects(recordResearchConsent(pool, { ...explanation, adultConfirmed: true, agreed: false }),
      (error) => error.code === 'RESEARCH_CONSENT_REQUIRED');
    await assert.rejects(recordResearchConsent(pool, { ...explanation, adultConfirmed: true, agreed: true, contentHash: '0'.repeat(64) }),
      (error) => error.code === 'RESEARCH_CONSENT_VERSION_STALE');
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM research_consents')).rows[0].count, 0);
    const receipt = await recordResearchConsent(pool, {
      version: explanation.version, contentHash: explanation.contentHash, adultConfirmed: true, agreed: true,
    });
    const researchConsentReceiptId = receipt.receiptId;
    assert.equal(receipt.participantNumber, 'FG-0001');
    assert.equal(receipt.agreed, true);
    assert.ok(receipt.consentedAt);
    assert.equal((await query('SELECT last_issued FROM research_participant_counter')).rows[0].last_issued, 1);

    await assert.rejects(signupUser(pool, { ...base, birthDate: underageBirthDate, agreements, researchConsentReceiptId }),
      (error) => error.code === 'AGE_NOT_ELIGIBLE');
    await assert.rejects(signupUser(pool, base),
      (error) => error.code === 'CONSENT_PAYLOAD_INVALID');
    await assert.rejects(signupUser(pool, { ...base, agreements: agreements.slice(1), researchConsentReceiptId }),
      (error) => error.code === 'CONSENT_REQUIRED_MISSING');
    await assert.rejects(signupUser(pool, { ...base, agreements }),
      (error) => error.code === 'RESEARCH_CONSENT_REQUIRED');
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count, 0);
    await assert.rejects(signupUser(pool, { ...base, participantNumber: 'FG-9999', agreements, researchConsentReceiptId }),
      (error) => error.code === 'PARTICIPANT_NUMBER_MISMATCH');

    const { user } = await signupUser(pool, { ...base, agreements, researchConsentReceiptId });
    assert.equal(user.participantNumber, receipt.participantNumber);
    assert.equal(user.consent.completed, true);
    const saved = await query('SELECT consent_type, consent_version, content_hash, consented_at FROM user_consents WHERE user_id = $1', [user.id]);
    assert.equal(saved.rows.length, agreements.length);
    for (const row of saved.rows) {
      const document = documents.find(({ type }) => type === row.consent_type);
      assert.equal(row.consent_version, document.version);
      assert.equal(row.content_hash, consentContentHash(document));
      assert.ok(row.consented_at);
    }
    await assert.rejects(assertAiConsent(pool, user.id), (error) => error.status === 403 && error.code === 'AI_CONSENT_REQUIRED');
    const aiDocument = documents.find(({ type }) => type === 'AI_EXPLANATION');
    await assert.rejects(grantAiConsent(pool, user.id, { version: aiDocument.version, contentHash: '0'.repeat(64) }),
      (error) => error.status === 409 && error.code === 'CONSENT_VERSION_STALE');
    await grantAiConsent(pool, user.id, { version: aiDocument.version, contentHash: aiDocument.contentHash });
    await assertAiConsent(pool, user.id);
    const aiGranted = await query('SELECT consent_version, content_hash, status, consented_at FROM user_consents WHERE user_id = $1 AND consent_type = $2', [user.id, 'AI_EXPLANATION']);
    assert.equal(aiGranted.rows.length, 1);
    assert.equal(aiGranted.rows[0].consent_version, aiDocument.version);
    assert.equal(aiGranted.rows[0].content_hash, aiDocument.contentHash);
    assert.equal(aiGranted.rows[0].status, 'GRANTED');
    assert.ok(aiGranted.rows[0].consented_at);
    await withdrawAiConsent(pool, user.id);
    await assert.rejects(assertAiConsent(pool, user.id), (error) => error.status === 403 && error.code === 'AI_CONSENT_REQUIRED');
    const aiWithdrawn = await query('SELECT status, withdrawn_at FROM user_consents WHERE user_id = $1 AND consent_type = $2', [user.id, 'AI_EXPLANATION']);
    assert.equal(aiWithdrawn.rows[0].status, 'WITHDRAWN');
    assert.ok(aiWithdrawn.rows[0].withdrawn_at);
    const researchRecord = await query('SELECT document_version, content_hash, agreed, consented_at, participant_number, used_at FROM research_consents WHERE id = $1', [researchConsentReceiptId]);
    assert.equal(researchRecord.rows[0].document_version, explanation.version);
    assert.equal(researchRecord.rows[0].content_hash.trim(), explanation.contentHash);
    assert.equal(researchRecord.rows[0].participant_number, receipt.participantNumber);
    assert.equal(researchRecord.rows[0].agreed, true);
    assert.ok(researchRecord.rows[0].consented_at);
    assert.ok(researchRecord.rows[0].used_at);

    await assert.rejects(signupUser(pool, { ...base, email: 'replay@example.test', agreements, researchConsentReceiptId }),
      (error) => error.code === 'RESEARCH_CONSENT_REQUIRED');

    const secondReceipt = await recordResearchConsent(pool, {
      version: explanation.version, contentHash: explanation.contentHash, adultConfirmed: true, agreed: true,
    });
    assert.equal(secondReceipt.participantNumber, 'FG-0002');
    const second = await signupUser(pool, { ...base, email: 'second@example.test', agreements, researchConsentReceiptId: secondReceipt.receiptId });
    assert.equal(second.user.participantNumber, secondReceipt.participantNumber);
    assert.notEqual(second.user.participantNumber, user.participantNumber);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count, 2);

    await withdrawUser(pool, user.id);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM users')).rows[0].count, 1);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM user_consents WHERE user_id = $1', [user.id])).rows[0].count, 0);
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM research_consents WHERE id = $1', [researchConsentReceiptId])).rows[0].count, 1);
    const withdrawnConsent = await query('SELECT agreed, withdrawn_at FROM research_consents WHERE id = $1', [researchConsentReceiptId]);
    assert.equal(withdrawnConsent.rows[0].agreed, false);
    assert.ok(withdrawnConsent.rows[0].withdrawn_at);
    const withdrawal = await query('SELECT participant_number, withdrawn_at FROM participant_withdrawals');
    assert.equal(withdrawal.rows.length, 1);
    assert.equal(withdrawal.rows[0].participant_number, receipt.participantNumber);
    assert.ok(withdrawal.rows[0].withdrawn_at);
    await assert.rejects(signupUser(pool, { ...base, agreements, researchConsentReceiptId: secondReceipt.receiptId }),
      (error) => error.code === 'RESEARCH_CONSENT_REQUIRED');
  } finally {
    await db.close();
  }
});

test('기존 번호를 건너뛰고 9999 이후에는 중복 발급하지 않는다', async () => {
  const db = new PGlite();
  const query = db.query.bind(db);
  const pool = { query, async connect() { return { query, release() {} }; } };
  try {
    await ensureAuthSchema(pool);
    await query("INSERT INTO participant_withdrawals (participant_number) VALUES ('FG-9301')");
    const oldDocument = publicResearchConsentDocument();
    await query(`INSERT INTO research_consents (id, document_version, content_hash, adult_confirmed, participant_number)
      VALUES ('00000000-0000-4000-8000-000000000001', $1, $2, TRUE, 'FG-9301')`,
    [oldDocument.version, oldDocument.contentHash]);
    await ensureAuthSchema(pool);
    const migrated = await query("SELECT agreed, withdrawn_at FROM research_consents WHERE participant_number = 'FG-9301'");
    assert.equal(migrated.rows[0].agreed, false);
    assert.ok(migrated.rows[0].withdrawn_at);
    const document = publicResearchConsentDocument();
    const consent = { version: document.version, contentHash: document.contentHash, adultConfirmed: true, agreed: true };
    const receipt = await recordResearchConsent(pool, consent);
    assert.equal(receipt.participantNumber, 'FG-9302');
    await query('UPDATE research_participant_counter SET last_issued = 9999 WHERE id = 1');
    await assert.rejects(recordResearchConsent(pool, consent),
      (error) => error.code === 'PARTICIPANT_NUMBERS_EXHAUSTED');
    assert.equal((await query('SELECT COUNT(*)::int AS count FROM research_consents')).rows[0].count, 2);
  } finally {
    await db.close();
  }
});
