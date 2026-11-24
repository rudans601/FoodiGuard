import crypto from 'node:crypto';

import { researchConsentText } from './researchConsentText.js';

// 수정 3차 연구대상자 설명문. IRB 승인 전 판본이므로 승인 문구가 바뀌면
// version과 원문을 함께 바꾸고 기존 영수증으로는 신규 가입을 허용하지 않는다.
export const researchConsentVersion = 'ver1.0-public.1';
export const researchConsentHash = crypto.createHash('sha256').update(researchConsentText, 'utf8').digest('hex');

export function publicResearchConsentDocument() {
  return {
    title: '연구대상자를 위한 설명문',
    version: researchConsentVersion,
    contentHash: researchConsentHash,
    text: researchConsentText,
  };
}

function consentError(status, code, message) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

export async function ensureResearchConsentSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_consents (
      id UUID PRIMARY KEY,
      document_version VARCHAR(30) NOT NULL,
      content_hash CHAR(64) NOT NULL,
      adult_confirmed BOOLEAN NOT NULL CHECK (adult_confirmed),
      agreed BOOLEAN NOT NULL DEFAULT TRUE,
      consented_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      participant_number VARCHAR(7) UNIQUE,
      used_at TIMESTAMPTZ,
      withdrawn_at TIMESTAMPTZ
    )
  `);
  await pool.query('ALTER TABLE research_consents ADD COLUMN IF NOT EXISTS agreed BOOLEAN NOT NULL DEFAULT TRUE');
  await pool.query('ALTER TABLE research_consents ADD COLUMN IF NOT EXISTS withdrawn_at TIMESTAMPTZ');
  await pool.query(`
    UPDATE research_consents rc
    SET agreed = FALSE, withdrawn_at = pw.withdrawn_at
    FROM participant_withdrawals pw
    WHERE rc.participant_number = pw.participant_number
      AND (rc.agreed IS DISTINCT FROM FALSE OR rc.withdrawn_at IS NULL)
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS research_participant_counter (
      id SMALLINT PRIMARY KEY CHECK (id = 1),
      last_issued INTEGER NOT NULL CHECK (last_issued BETWEEN 0 AND 9999)
    )
  `);
  // Existing manually assigned numbers and withdrawals remain reserved. Never
  // restart at FG-0001 when upgrading a database with prior participants.
  await pool.query(`
    INSERT INTO research_participant_counter (id, last_issued)
    SELECT 1, GREATEST(
      COALESCE((SELECT MAX(SUBSTRING(participant_number FROM 4)::INTEGER)
        FROM research_consents WHERE participant_number ~ '^FG-[0-9]{4}$'), 0),
      COALESCE((SELECT MAX(SUBSTRING(participant_number FROM 4)::INTEGER)
        FROM users WHERE participant_number ~ '^FG-[0-9]{4}$'), 0),
      COALESCE((SELECT MAX(SUBSTRING(participant_number FROM 4)::INTEGER)
        FROM participant_withdrawals WHERE participant_number ~ '^FG-[0-9]{4}$'), 0)
    )
    ON CONFLICT (id) DO UPDATE SET last_issued = GREATEST(
      research_participant_counter.last_issued, EXCLUDED.last_issued)
  `);
}

export async function recordResearchConsent(pool, payload = {}) {
  if (payload.agreed !== true || payload.adultConfirmed !== true) {
    throw consentError(400, 'RESEARCH_CONSENT_REQUIRED', '만 19세 이상이며 연구 참여에 동의해야 다음으로 진행할 수 있습니다.');
  }
  if (payload.version !== researchConsentVersion || payload.contentHash !== researchConsentHash) {
    throw consentError(409, 'RESEARCH_CONSENT_VERSION_STALE', '연구 설명문이 갱신되었습니다. 다시 읽고 동의해주세요.');
  }
  const client = await pool.connect();
  let row;
  try {
    await client.query('BEGIN');
    const issued = await client.query(`
      UPDATE research_participant_counter SET last_issued = last_issued + 1
      WHERE id = 1 AND last_issued < 9999 RETURNING last_issued
    `);
    if (!issued.rows.length) {
      throw consentError(409, 'PARTICIPANT_NUMBERS_EXHAUSTED', '발급 가능한 연구참여자 번호가 없습니다. 연구팀에 문의해주세요.');
    }
    const participantNumber = `FG-${String(issued.rows[0].last_issued).padStart(4, '0')}`;
    const result = await client.query(`
      INSERT INTO research_consents (id, document_version, content_hash, adult_confirmed, agreed, participant_number)
      VALUES ($1, $2, $3, TRUE, TRUE, $4)
      RETURNING id, document_version, content_hash, agreed, consented_at, participant_number
    `, [crypto.randomUUID(), researchConsentVersion, researchConsentHash, participantNumber]);
    row = result.rows[0];
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return {
    receiptId: row.id,
    version: row.document_version,
    contentHash: row.content_hash.trim(),
    consentedAt: row.consented_at,
    agreed: row.agreed,
    participantNumber: row.participant_number,
  };
}

// 가입과 같은 트랜잭션에서 한 번만 사용한다. 화면을 우회하거나 이미 사용한
// 영수증을 재전송한 가입은 거절하고, 계정 저장이 실패하면 사용 처리도 롤백한다.
export async function claimResearchConsent(client, receiptId) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(receiptId || ''))) {
    throw consentError(403, 'RESEARCH_CONSENT_REQUIRED', '연구 참여 동의를 먼저 완료해주세요.');
  }
  const result = await client.query(`
    UPDATE research_consents
    SET used_at = NOW()
    WHERE id = $1 AND used_at IS NULL AND agreed = TRUE
      AND participant_number IS NOT NULL AND document_version = $2 AND content_hash = $3
    RETURNING participant_number
  `, [receiptId, researchConsentVersion, researchConsentHash]);
  if (!result.rows.length) {
    throw consentError(403, 'RESEARCH_CONSENT_REQUIRED', '연구 참여 동의가 없거나 판본이 변경되었습니다. 다시 동의해주세요.');
  }
  return result.rows[0].participant_number;
}
