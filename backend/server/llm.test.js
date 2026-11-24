import assert from 'node:assert/strict';
import test from 'node:test';

import { buildPrompt, compactPayload, ensureMissingNutritionNotice, generateCartExplanation } from './llm.js';

test('AI 요청 데이터에서 결측은 null이고 실제 0은 0이다', () => {
  const compacted = compactPayload({
    cart: {
      items: [{ name: '시험 식품', nutrients: { sugar: null, calories: 0 } }],
      totals: { sugar: null, calories: 0, sodium: '' },
    },
  });
  assert.equal(compacted.cart.totals.sugar, null);
  assert.equal(compacted.cart.items[0].nutrients.sugar, null);
  assert.equal(compacted.cart.totals.calories, 0);
  assert.equal(compacted.cart.totals.sodium, null);
  const prompt = buildPrompt(compacted);
  assert.match(prompt, /null mean information is missing, not zero/);
  assert.match(prompt, /"sugar":null/);
});

test('AI 답변에 누락 영양소 안내를 보장한다', () => {
  const explanation = { summary: '조합을 확인했어요.', cartReasons: [], cautions: [] };
  const result = ensureMissingNutritionNotice(explanation, { sugar: null, calories: 130, sodium: 0, protein: 2, fiber: 1, saturatedFat: 0 });
  assert.match(result.cautions[0], /당류 정보 부족/);
  assert.equal(ensureMissingNutritionNotice(explanation, { sugar: 0, calories: 130, sodium: 0, protein: 2, fiber: 1, saturatedFat: 0 }), explanation);
});


test('로컬 모델 응답에도 기존 알레르기 문장 필터와 결측 안내를 적용한다', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://ollama:11434/api/chat');
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'qwen2.5:0.5b');
    assert.ok(body.format.required.includes('summary'));
    assert.equal(body.stream, false);
    return Response.json({ message: { content: JSON.stringify({
      summary: '영양 구성을 확인했어요.', cartReasons: ['알레르기가 있어도 안전해요.'],
    }) } });
  });
  const result = await generateCartExplanation({ cart: { items: [{ name: '예시 식품' }] } });
  assert.deepEqual(result.cartReasons, []);
  assert.match(result.cautions[0], /정보 부족/);
});
