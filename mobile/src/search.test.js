import assert from 'node:assert/strict';
import test from 'node:test';
import { hasUnresolvedIngredients as serverHasUnresolvedIngredients } from '../../backend/server/productSafety.js';

import {
  defaultProfile,
  expandAvoidToAllergens,
  getAvoidMatches,
  hasUnresolvedIngredients,
  isAllowedForProfile,
  sortProducts,
  uniqueProducts,
} from './domain.js';

function product(id, name, extra = {}) {
  return {
    id,
    name,
    maker: extra.maker ?? '테스트제조',
    allergens: extra.allergens ?? [],
    ingredients: extra.ingredients ?? '',
    nutrients: {
      calories: 150, protein: 8, carbs: 20, fat: 4,
      sugar: 3, sodium: 200, saturatedFat: 1, fiber: 2,
      ...(extra.nutrients || {}),
    },
    ...extra.rest,
  };
}

test('P1 검색 — 앱 알레르기 표기를 DB 코드로 넓혀 준다', () => {
  assert.deepEqual(expandAvoidToAllergens(['메밀']), ['BUCKWHEAT']);
  assert.deepEqual(expandAvoidToAllergens(['잣']), ['PINE_NUT']);
  assert.deepEqual(expandAvoidToAllergens(['아황산류']), ['SULFITES']);
  // 묶음 표기는 해당 코드 전부로 펼쳐진다.
  assert.deepEqual(expandAvoidToAllergens(['갑각류']).sort(), ['CRAB', 'SHELLFISH', 'SHRIMP']);
  // 같은 코드를 두 번 골라도 중복되지 않고, 모르는 값은 무시한다.
  assert.deepEqual(expandAvoidToAllergens(['우유', '우유', '없는항목']), ['MILK']);
  assert.deepEqual(expandAvoidToAllergens([]), []);
});

test('P1 검색 — 프로필 알레르기와 겹치는 식품을 집어낸다', () => {
  const profile = { ...defaultProfile, avoidIngredients: ['메밀'] };
  const buckwheat = product('a', '평양냉면', { allergens: ['BUCKWHEAT'] });
  const safe = product('b', '흰쌀 즉석밥', { allergens: [] });

  assert.deepEqual(getAvoidMatches(buckwheat, profile), ['BUCKWHEAT']);
  assert.equal(isAllowedForProfile(buckwheat, profile), false);
  assert.equal(isAllowedForProfile(safe, profile), true);
  // 프로필에 제한이 없으면 아무것도 막지 않는다.
  assert.equal(isAllowedForProfile(buckwheat, defaultProfile), true);
});

test('IRB 알레르기 — 상품명 단서와 원재료 정보 누락도 제외한다', () => {
  const profile = { ...defaultProfile, avoidIngredients: ['메밀', '우유'] };
  const databaseProduct = (id, name, ingredients) => product(`db-${id}`, name, {
    ingredients,
    rest: { source: 'food-db', ingredientStatus: 'matched' },
  });
  assert.equal(isAllowedForProfile(databaseProduct(1, '메밀소바', '숙면, 소스'), profile), false);
  assert.equal(isAllowedForProfile(databaseProduct(2, '플레인 요거트', '발효유'), profile), false);
  assert.equal(isAllowedForProfile(databaseProduct(5, '참기름비빔막국수', '건면, 소스'), profile), false);
  assert.deepEqual(getAvoidMatches(databaseProduct(6, '사과음료', '사과, 소스'), profile), ['원재료 정보 부족']);
  assert.equal(isAllowedForProfile(databaseProduct(7, '쌀과자', '쌀, 혼합제제'), profile), false);
  assert.equal(isAllowedForProfile(databaseProduct(8, '곡물간식', '쌀, 드레싱'), profile), false);
  assert.deepEqual(getAvoidMatches(databaseProduct(3, '사과식품', ''), profile), ['원재료 정보 부족']);
  assert.equal(isAllowedForProfile(databaseProduct(3, '사과식품', ''), profile), false);
  assert.equal(isAllowedForProfile(databaseProduct(4, '사과식품', '사과, 배'), profile), true);
});

test('서버와 앱이 복합·불명 원재료를 같은 기준으로 판정한다', () => {
  for (const [ingredients, unresolved] of [
    ['사과, 배', false], ['쌀, 소스', true], ['건면, 참기름', true],
    ['쌀, 복합조미식품', true], ['쌀, 기타가공품', true],
    ['쌀, 혼합제제', true], ['쌀, 드레싱', true],
    ['원재료 미상', true], ['알레르기 혼입 가능', true],
  ]) {
    assert.equal(hasUnresolvedIngredients(ingredients), unresolved, ingredients);
    assert.equal(serverHasUnresolvedIngredients(ingredients), unresolved, ingredients);
  }
});

test('밀·대두 텍스트 단서는 다른 곡물·콩류 이름과 구분한다', () => {
  const wheat = { ...defaultProfile, avoidIngredients: ['밀'] };
  const soy = { ...defaultProfile, avoidIngredients: ['대두'] };
  for (const name of ['메밀면', '모밀국수', '오트밀', '호밀빵', '밀크티', '밀키트']) {
    assert.equal(isAllowedForProfile(product(name, name, { ingredients: name }), wheat), true, name);
  }
  for (const name of ['땅콩', '병아리콩', '강낭콩', '완두콩']) {
    assert.equal(isAllowedForProfile(product(name, name, { ingredients: name }), soy), true, name);
  }
  assert.equal(isAllowedForProfile(product('w', '메밀면', { ingredients: '메밀, 밀가루' }), wheat), false);
  assert.equal(isAllowedForProfile(product('w2', '밀쌈말이', { ingredients: '쌀' }), wheat), false);
  assert.equal(isAllowedForProfile(product('s', '국산콩비지찌개', { ingredients: '콩비지' }), soy), false);
  assert.equal(isAllowedForProfile(product('s2', '땅콩두부', { ingredients: '땅콩, 두부' }), soy), false);
  assert.equal(isAllowedForProfile(product('s3', '땅콩', { ingredients: '땅콩', allergens: ['SOY'] }), soy), false);
  assert.equal(isAllowedForProfile(product('s4', '땅콩', { ingredients: '땅콩' }),
    { ...defaultProfile, avoidIngredients: ['대두', '땅콩'] }), false);
  // A custom word is an explicit literal request, even if it matches another bean.
  assert.equal(isAllowedForProfile(product('custom', '땅콩', { ingredients: '땅콩' }),
    { ...defaultProfile, avoidIngredients: ['대두'], avoidCustom: '콩' }), false);
});

test('P1 검색 — 같은 상품의 중복 노출을 접는다', () => {
  const items = [
    product('1', '저염 닭가슴살'),
    product('2', '저염  닭가슴살'), // 공백만 다른 같은 상품
    product('3', '저염 닭가슴살', { maker: '다른제조' }),
  ];
  const unique = uniqueProducts(items);

  assert.deepEqual(unique.map((item) => item.id), ['1', '3']);
  assert.deepEqual(uniqueProducts([]), []);
});

test('P1 검색 — 정렬 기준을 바꾸면 순서가 그에 맞게 바뀐다', () => {
  const items = [
    product('salty', '나 저염 라면', { nutrients: { sodium: 1800, sugar: 12 } }),
    product('clean', '가 담백 닭가슴살', { nutrients: { sodium: 90, sugar: 0 } }),
  ];

  const byName = sortProducts(items, 'name', defaultProfile).map((item) => item.id);
  assert.deepEqual(byName, ['clean', 'salty'], '가나다순은 이름 기준이다');

  const byScore = sortProducts(items, 'score', defaultProfile);
  assert.ok(byScore[0].analysis.score >= byScore[1].analysis.score, '추천순은 점수 내림차순이다');

  // 정렬 함수는 입력을 버리지 않는다. 화면에서 isAllowedForProfile로 표시 대상을 거른다.
  const profile = { ...defaultProfile, avoidIngredients: ['메밀'] };
  const withBlocked = sortProducts(
    [...items, product('block', '메밀 냉면', { allergens: ['BUCKWHEAT'] })],
    'score',
    profile,
  );
  assert.equal(withBlocked.length, 3);
});
