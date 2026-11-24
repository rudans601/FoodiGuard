// 원재료 표기가 상위 원료명(예: "숙면, 소스")에 그치면 알레르기 코드가
// 비어 있어도 상품명에는 유발물질이 드러날 수 있다. 코드와 상품명을 함께 검사한다.
// 식품명 단서에는 오탐이 적은 표현만 넣고, 원재료 기반 코드는 별도로 유지한다.
const nameTermsByCode = {
  EGG: ['계란', '달걀', '메추리알', '에그'],
  MILK: ['우유', '밀크', '요거트', '요구르트', '치즈', '분유', '연유', '생크림', '휘핑크림'],
  BUCKWHEAT: ['메밀', '모밀', '막국수', '소바', 'buckwheat', 'soba'],
  PEANUT: ['땅콩', '피넛'],
  SOY: ['대두', '두부', '두유'],
  WHEAT: ['밀가루', '통밀', '우리밀', '소맥', '글루텐'],
  WALNUT: ['호두'],
  PINE_NUT: ['잣'],
  MACKEREL: ['고등어'],
  CRAB: ['꽃게', '대게', '홍게', '크랩'],
  SHRIMP: ['새우'],
  SQUID: ['오징어'],
  SHELLFISH: ['조개', '전복', '홍합', '바지락', '가리비', '꼬막'],
  PORK: ['돼지고기', '돈육', '삼겹살'],
  CHICKEN: ['닭고기', '치킨', '계육'],
  BEEF: ['쇠고기', '소고기', '한우', '우육'],
  PEACH: ['복숭아'],
  TOMATO: ['토마토'],
  SULFITES: ['아황산', '이산화황'],
};

// 하위 원료가 공개되지 않은 복합원재료는 알레르기 코드가 비어 있어도
// 선택한 유발물질이 없다는 근거가 되지 않는다. DB 원재료 90만 건에서 실제로
// 쓰인 포괄 표기를 대상으로 한다. 앱의 방어 판정도 같은 식을 사용한다.
export const unresolvedIngredientPattern = '소스|건면|기타가공품|복합조미식품|향료|혼합제제|드레싱|시즈닝|양념|스프|페이스트|믹스|원재료(불명|미상|정보없음|확인불가)|성분(불명|미상|정보없음|확인불가)|알레르기.{0,12}(가능|불명|미상)|혼입.{0,4}가능';
const unresolvedIngredientRegex = new RegExp(unresolvedIngredientPattern, 'i');

export function hasUnresolvedIngredients(text) {
  return unresolvedIngredientRegex.test(String(text || '').normalize('NFKC').replace(/\s+/g, ''));
}

export function allergenNameTerms(codes = []) {
  return [...new Set(codes.flatMap((code) => nameTermsByCode[code] || []))];
}

export function appendAllergenExclusions(conditions, values, excludeCodes = []) {
  if (!excludeCodes.length) return;

  // 성분 전문이 비어 있으면 알레르기 코드가 없어도 안전하다고 판단할 수 없다.
  conditions.push("NULLIF(BTRIM(ingredient_summary_text), '') IS NOT NULL");
  values.push(unresolvedIngredientPattern);
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM food_ingredients fi
    WHERE fi.food_id = food_app_view.id AND fi.normalized_name ~ $${values.length}
  )`);
  values.push(excludeCodes);
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM food_allergens fa
    WHERE fa.food_id = food_app_view.id AND fa.allergen_code = ANY($${values.length}::varchar[])
  )`);

  const nameTerms = allergenNameTerms(excludeCodes);
  if (!nameTerms.length) return;
  values.push(nameTerms);
  conditions.push(`NOT EXISTS (
    SELECT 1 FROM UNNEST($${values.length}::text[]) AS risky_name(term)
    WHERE STRPOS(food_app_view.normalized_name, risky_name.term) > 0
  )`);
}
