import { ALLERGEN_CODE_BY_LABEL, deriveAllergens } from './allergens.js';
import { allergenNameTerms, hasUnresolvedIngredients } from './productSafety.js';

const unknownNotice = '알레르기 정보를 확인할 수 없어 섭취 적합성을 판단할 수 없습니다.';
const packageNotice = '섭취 전 제품 포장의 원재료·알레르기 표시를 확인해 주세요.';
const labelAliases = {
  '알류(가금류)': ['난류'], 계란: ['난류'], 달걀: ['난류'],
  견과류: ['땅콩', '호두', '잣'],
  갑각류: ['게', '새우', '조개류'],
  생선: ['고등어', '오징어'],
  소고기: ['쇠고기'],
};

function selectedAllergens(profile = {}) {
  const selected = Array.isArray(profile.avoidIngredients) ? profile.avoidIngredients : [];
  const labels = [];
  let unrecognized = false;
  for (const value of selected) {
    const label = String(value || '').trim();
    const expanded = labelAliases[label] || (ALLERGEN_CODE_BY_LABEL[label] ? [label] : []);
    if (!expanded.length && label) unrecognized = true;
    for (const item of expanded) if (!labels.includes(item)) labels.push(item);
  }
  return { labels, unrecognized, hasSelection: selected.some((value) => String(value || '').trim()) };
}

function foodId(value) {
  const match = /^(?:db-)?([1-9]\d*)$/.exec(String(value || ''));
  return match ? match[1] : null;
}

// AI가 받은 원재료 텍스트 대신 현재 DB 원본을 확인한다. 합성 밥이나 삭제된 식품은 미확인으로 남긴다.
export async function loadCartAllergenEvidence(db, itemIds = []) {
  const ids = Array.isArray(itemIds) ? itemIds : [];
  const dbIds = [...new Set(ids.map(foodId).filter(Boolean))];
  if (!dbIds.length) return ids.map(() => null);
  const { rows } = await db.query(
    `SELECT id, normalized_name, ingredient_status, ingredient_summary_text, allergen_codes
     FROM food_app_view WHERE id = ANY($1::bigint[])`,
    [dbIds],
  );
  const byId = new Map(rows.map((row) => [String(row.id), row]));
  return ids.map((id) => byId.get(foodId(id)) || null);
}

export function buildAllergenNotices(profile, evidence = []) {
  const { labels, unrecognized, hasSelection } = selectedAllergens(profile);
  if (!hasSelection) return [];
  const present = new Set();
  let incomplete = unrecognized || !evidence.length;

  for (const row of evidence) {
    if (!row || row.ingredient_status !== 'matched'
      || !String(row.ingredient_summary_text || '').trim()
      || hasUnresolvedIngredients(row.ingredient_summary_text)) incomplete = true;
    if (!row) continue;
    const recorded = new Set([
      ...(Array.isArray(row.allergen_codes) ? row.allergen_codes : []),
      ...deriveAllergens(String(row.ingredient_summary_text || '').split(',')).codes,
    ]);
    const name = String(row.normalized_name || '').toLowerCase();
    for (const label of labels) {
      const code = ALLERGEN_CODE_BY_LABEL[label];
      if (recorded.has(code) || allergenNameTerms([code]).some((term) => name.includes(term.toLowerCase()))) {
        present.add(label);
      }
    }
  }

  const notices = [];
  if (present.size) notices.push(`현재 등록된 자료에서 ${[...present].join('·')} 함유 표시가 확인됩니다. ${packageNotice}`);
  if (incomplete) notices.push(unknownNotice);
  if (!notices.length) notices.push(`현재 등록된 자료에서 ${labels.join('·')} 함유 표시는 확인되지 않았습니다. ${packageNotice}`);
  return notices;
}

// 생성형 문장은 안전 판정을 맡지 않는다. 알레르기 관련 표현은 근거 기반 안내로 대체한다.
const allergyClaimPattern = /알레르|알러지|안심|안전|섭취|먹어|먹을|드셔|함유|포함|혼입|교차.{0,3}오염|원재료|무해|괜찮|걱정.{0,3}없|문제.{0,3}없|들어.?있|메밀|모밀|소바|우유|치즈|요거트|요구르트|난류|계란|달걀|땅콩|대두|밀가루|호두|잣|고등어|새우|조개|돼지고기|닭고기|쇠고기|복숭아|토마토|아황산/i;

export function removeGeneratedAllergyClaims(explanation) {
  const keep = (text) => !allergyClaimPattern.test(text);
  return {
    ...explanation,
    summary: keep(explanation.summary) ? explanation.summary : '장바구니의 영양 정보를 확인했어요.',
    cartReasons: (explanation.cartReasons || []).filter(keep),
    cautions: (explanation.cautions || []).filter(keep),
    replacement: {
      ...explanation.replacement,
      from: keep(explanation.replacement?.from) ? explanation.replacement?.from : '',
      to: keep(explanation.replacement?.to) ? explanation.replacement?.to : '',
      reasons: (explanation.replacement?.reasons || []).filter(keep),
    },
  };
}
