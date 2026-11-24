import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeCart, createRiceItem, defaultProfile } from './domain.js';
import { getCalculatedNutrients, summarizeCart } from './nutritionScoring.js';

function food(id, sugar) {
  return {
    id, name: `검증 식품 ${id}`, serving: '100g', foodWeight: '100g',
    nutritionBasis: { servingSize: '100g', totalWeight: '100g' },
    nutrients: { calories: 100, protein: 2, sugar, sodium: 0, saturatedFat: 0, fiber: 1 },
  };
}

test('백미밥 100g은 장바구니 합계에 130kcal만 더해진다', () => {
  const rice = createRiceItem('백미밥', 100);
  assert.equal(getCalculatedNutrients(rice).conversion.factor, 1);
  assert.equal(analyzeCart([rice], defaultProfile).totals.calories, 130);
  assert.equal(analyzeCart([food('기본', 0), rice], defaultProfile).totals.calories, 230);
  assert.equal(analyzeCart([createRiceItem('백미밥', 200)], defaultProfile).totals.calories, 260);
});

test('일부 식품의 영양값이 비면 합계는 null, 실제 0은 0으로 유지한다', () => {
  const missing = food('결측', null);
  const zero = food('영', 0);
  assert.equal(summarizeCart([missing, zero]).sugar, null);
  assert.equal(analyzeCart([missing, zero], defaultProfile).totals.sugar, null);
  assert.equal(summarizeCart([zero, zero]).sugar, 0);
  assert.equal(summarizeCart([missing]).sugar, null);
});
