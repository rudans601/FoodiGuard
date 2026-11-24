import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllergenNotices, loadCartAllergenEvidence, removeGeneratedAllergyClaims } from './aiAllergenNotice.js';

const profile = { avoidIngredients: ['메밀', '우유'] };
const matched = {
  id: 12,
  normalized_name: '쌀미음',
  ingredient_status: 'matched',
  ingredient_summary_text: '쌀, 정제수',
  allergen_codes: [],
};

test('등록 원재료가 있는 모든 장바구니 식품에 안전 단정 대신 포장 확인 문구를 붙인다', () => {
  const notices = buildAllergenNotices(profile, [matched]);
  assert.deepEqual(notices, [
    '현재 등록된 자료에서 메밀·우유 함유 표시는 확인되지 않았습니다. 섭취 전 제품 포장의 원재료·알레르기 표시를 확인해 주세요.',
  ]);
  assert.doesNotMatch(notices[0], /안심|안전/);
});

test('원재료 누락과 구성이 불명확한 원료는 섭취 적합성 미확인으로 안내한다', () => {
  const notice = '알레르기 정보를 확인할 수 없어 섭취 적합성을 판단할 수 없습니다.';
  assert.deepEqual(buildAllergenNotices(profile, [matched, null]), [notice]);
  assert.deepEqual(buildAllergenNotices(profile, [{ ...matched, ingredient_summary_text: '쌀, 분말스프' }]), [notice]);
  assert.deepEqual(buildAllergenNotices(profile, [{ ...matched, ingredient_status: 'pending' }]), [notice]);
});

test('함유 표시가 있는 경우 부재 문구를 내지 않고, 다른 식품의 미확인도 함께 알린다', () => {
  const milk = { ...matched, id: 13, ingredient_summary_text: '원유, 정제수', allergen_codes: ['MILK'] };
  const notices = buildAllergenNotices(profile, [milk, null]);
  assert.match(notices[0], /우유 함유 표시가 확인됩니다/);
  assert.match(notices[1], /섭취 적합성을 판단할 수 없습니다/);
  assert.doesNotMatch(notices.join(' '), /함유 표시는 확인되지 않았습니다/);
});

test('서버는 요청 식품 ID를 DB와 대조하고 합성·삭제 식품은 미확인으로 둔다', async () => {
  let boundIds;
  const db = { async query(_sql, values) { boundIds = values[0]; return { rows: [matched] }; } };
  const evidence = await loadCartAllergenEvidence(db, ['db-12', 'rice-백미밥-100', 'db-99']);
  assert.deepEqual(boundIds, ['12', '99']);
  assert.equal(evidence[0], matched);
  assert.equal(evidence[1], null);
  assert.equal(evidence[2], null);
});

test('AI가 생성한 알레르기 안전 단정은 화면에 전달하지 않는다', () => {
  const cleaned = removeGeneratedAllergyClaims({
    summary: '메밀과 우유가 포함돼 있지 않아 안심하고 섭취할 수 있습니다.',
    cartReasons: ['단백질 10g입니다.', '알레르기 걱정 없이 먹어도 됩니다.'],
    cautions: ['영양값 정보 부족', '제품 원재료가 안전합니다.'],
    replacement: { from: '현재', to: '계란이 없으니 괜찮아요', reasons: ['우유가 없어 안전합니다.', '나트륨이 낮습니다.'] },
  });
  assert.equal(cleaned.summary, '장바구니의 영양 정보를 확인했어요.');
  assert.deepEqual(cleaned.cartReasons, ['단백질 10g입니다.']);
  assert.deepEqual(cleaned.cautions, ['영양값 정보 부족']);
  assert.equal(cleaned.replacement.to, '');
  assert.deepEqual(cleaned.replacement.reasons, ['나트륨이 낮습니다.']);
});
