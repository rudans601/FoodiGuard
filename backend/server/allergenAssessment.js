// Pure evidence classifier. No DB/network access and no product-name inference.
// Input identity/version and OCR transcription must be verified upstream.
import { ALLERGEN_CODE_BY_LABEL, ALLERGEN_LABELS, ALLERGEN_RULES } from './allergenRules.js';
export { ALLERGEN_CODE_BY_LABEL, ALLERGEN_LABELS } from './allergenRules.js';
export const ALLERGEN_RULE_VERSION = '2026-11-07.2';

export function normalizeIngredientName(value) {
  return String(value ?? '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

function literalMatches(text) {
  return ALLERGEN_RULES.filter(rule => {
    const masked = rule.exclude.reduce((s, word) => s.split(word).join('·'), text);
    return rule.include.some(word => masked.includes(word));
  }).map(rule => ALLERGEN_CODE_BY_LABEL[rule.label]);
}

const PRECAUTION = /혼입|교차오염|같은(?:제조)?(?:시설|공장|라인|설비|공정)|동일(?:한)?(?:제조)?(?:시설|공장|라인|설비|공정)|함유(?:할|될)수|포함(?:할|될)수|함유가능|maycontain/;
const NEGATION = /무첨가|미첨가|불포함|미함유|무함유|불검출|함유하지않|함유안함|포함하지않|사용하지않|함유없|함유되어있지않|(?:혼입|교차오염)(?:가능성|가능|우려)?없|(?:우유|밀|땅콩|대두|계란|달걀|메밀|호두|잣|새우|게|오징어|고등어|조개류|돼지고기|닭고기|쇠고기|복숭아|토마토|아황산류)(?:없음|프리)|글루텐프리|무글루텐|^무(?:우유|난류|계란|달걀|대두|땅콩|메밀)/;
const COMPOUND = /소스|스프|수프|복합조미|혼합조미|조미식품|시즈닝|양념|드레싱|마요네즈|마가린|가공품|가공식품|가공육|가공치즈|가공버터|조제품|베이스|어묵|맛살|육수|스톡|식물성크림|휘핑크림|커스타드|슈크림|향미유/;
const AMBIGUOUS_ORIGIN = /간장|콩단백|콩가루|콩나물|글루텐|사골|젤라틴|콜라겐|알부민|리소자임|오브알부민|레시틴|어육|생선분말|해물|수산물|육추출|육엑기스|식육|치킨|비프|크릴|케첩|라이코펜|표백제|산화방지제|나무토마토|밀크밀/;
const ALTERNATIVE = /또는|혹은|대체품/;

function isFlavour(text) {
  return /향료|향미유|향혼합|향분말|향오일|향베이스|향페이스트|향액|향유|향제제|맛분말|맛살/.test(text)
    || (/향$/.test(text) && !/^(정향|회향|오향)$/.test(text));
}

function clauses(value) {
  // Join OCR line wraps, then scope independent positive/precaution/claim clauses.
  return String(value ?? '').normalize('NFKC')
    .replace(/無/g, '무').replace(/[ \t　]+/g, '')
    .replace(/(함유|혼입\s*가능(?:성\s*있음)?|무첨가|불포함|미함유)\s*\r?\n/g, '$1;')
    .replace(/[\r\n]+/g, ' ')
    .replace(/(무첨가|불포함|미함유)(?:이나|이지만|지만|이며|이고|하나)/g, '$1\n')
    .replace(/((?:함유|포함)(?:함|합니다|하고있습니다|하고있으며|되어있으며|되어있습니다|하고있음|되어있음)?|무첨가|불포함|미함유|불검출|함유하지않음|혼입가능(?:성있음)?)(\s*[,;]|그리고|하지만|다만|하며|이며)/g, '$1\n')
    .replace(/\s*(원재료(?:명)?|알레르기(?:\s*유발물질)?|혼입\s*(?:가능성|가능|주의)|주의사항)\s*[:：]/g, '\n$1:')
    .split(/[\n;。]|\.(?!\d)/).map(s => s.trim()).filter(Boolean);
}

function pushUnique(array, item) {
  if (!array.some(old => old.source === item.source && old.text === item.text && old.token === item.token && old.reason === item.reason)) array.push(item);
}

function scopedTokens(text, inherited = {}) {
  // Keep bracket scope: a claim inside one component cannot cancel its siblings.
  // e.g. 소스(우유, 글루텐프리전분) still supplies positive milk evidence.
  const parts = [];
  let plain = '';
  for (let i = 0; i < text.length; i += 1) {
    if (!'([{'.includes(text[i])) { plain += text[i]; continue; }
    parts.push({text: plain}); plain = '';
    const start = ++i;
    let depth = 1;
    while (i < text.length && depth) {
      if ('([{'.includes(text[i])) depth += 1;
      if (')]}'.includes(text[i])) depth -= 1;
      if (depth) i += 1;
    }
    parts.push({child: text.slice(start, i)});
  }
  parts.push({text: plain});
  const root = parts.map(part => part.text || '').join('·');
  // Prefix claims such as 글루텐프리전분 apply to that token only. A list ending
  // in 우유,대두 무첨가 is a claim about the list, never proof of absence.
  const groupClaim = /(?:무첨가|미첨가|불포함|미함유|불검출|함유하지않음|함유되어있지않음|없음)(?:입니다|함)?[·\s]*$/.test(root)
    || /^(?:무첨가|불포함|미함유):/.test(root);
  const scope = {
    precaution: inherited.precaution || PRECAUTION.test(root),
    negated: inherited.negated || groupClaim,
    declaration: inherited.declaration || /(?:함유|포함)(?:함|합니다|하고있습니다|하고있음|되어있습니다|되어있음)?[·]*$|알레르기.*:/.test(root),
  };
  return parts.flatMap(part => part.child !== undefined ? scopedTokens(part.child, scope)
    : part.text.split(/[;,、·]/).filter(Boolean).map(token => ({token,
      precaution: scope.precaution || PRECAUTION.test(token),
      negated: scope.negated || NEGATION.test(token), declaration: scope.declaration})));
}

// A status of UNKNOWN is lack of affirmative evidence, never an absence/safety claim.
// The source fields prevent OCR warning text from being treated as a raw ingredient.
export function assessAllergens({ ingredients = [], allergenStatements = [], precautionStatements = [] } = {}) {
  const evidenceByCode = Object.fromEntries(ALLERGEN_LABELS.map(label => [ALLERGEN_CODE_BY_LABEL[label], {contains: [], mayContain: [], claims: []}]));
  const unknownIngredients = [];
  for (const [source, entries] of [['ingredient', ingredients], ['allergen_statement', allergenStatements], ['precaution_statement', precautionStatements]]) {
    if (!Array.isArray(entries)) throw new TypeError(`${source} must be an array of strings`);
    for (const entry of entries) {
      if (entry != null && typeof entry !== 'string') throw new TypeError(`${source} entries must be strings`);
      const text = String(entry ?? '').trim();
      if (!text) continue;
      for (const clause of clauses(text)) {
        const normalized = normalizeIngredientName(clause);
        // Parent and nested components are evaluated independently. An ambiguous
        // parent remains unknown even when some of its children are disclosed.
        const tokens = scopedTokens(normalized.replace(/^(원재료명|원재료|알레르기유발물질|알레르기|주의사항):/, ''),
          {precaution: source === 'precaution_statement', declaration: source !== 'ingredient'});
        for (const {token, precaution, negated, declaration} of tokens) {
          const destination = negated ? 'claims' : precaution ? 'mayContain' : 'contains';
          const contextOnly = negated || precaution || declaration;
          const flavour = isFlavour(token);
          const alternative = ALTERNATIVE.test(token);
          const substitute = /(?:식물성|비건|대체)(?:우유|치즈|버터|크림)|(?:완두|녹두|강낭콩|병아리콩)(?:두부|된장|청국장|두유)/.test(token);
          const unresolved = alternative || flavour || substitute;
          const codes = unresolved ? [] : literalMatches(token);
          for (const code of codes) {
            pushUnique(evidenceByCode[code][destination], {source, text, token,
              reason: negated ? 'NEGATIVE_CLAIM_NOT_ABSENCE' : precaution ? 'PRECAUTION_STATEMENT' : declaration ? 'CONTAINS_STATEMENT' : 'INGREDIENT_SOURCE'});
          }
          if (unresolved || (!contextOnly && (COMPOUND.test(token) || (!codes.length && AMBIGUOUS_ORIGIN.test(token))))) {
            const reason = alternative ? 'ALTERNATIVE_CATEGORY' : flavour ? 'FLAVOUR_COMPOSITION_UNKNOWN' : substitute ? 'SUBSTITUTE_COMPOSITION_UNKNOWN' : COMPOUND.test(token) ? 'COMPOUND_COMPOSITION_UNVERIFIED' : 'ORIGIN_OR_COMPOSITION_UNVERIFIED';
            pushUnique(unknownIngredients, {source, text, token, reason});
          }
          if (negated) pushUnique(unknownIngredients, {source, text, token, reason: 'NEGATIVE_CLAIM_NOT_ABSENCE'});
        }
        const stack = [];
        let malformed = false;
        for (const char of normalized) {
          if ('([{'.includes(char)) stack.push(char);
          else if (')]}'.includes(char) && stack.pop() !== {')':'(', ']':'[', '}':'{'}[char]) malformed = true;
        }
        if (malformed || stack.length) pushUnique(unknownIngredients, {source, text, token: normalized, reason: 'MALFORMED_BRACKETS'});
      }
    }
  }
  const labels = ALLERGEN_LABELS.filter(label => evidenceByCode[ALLERGEN_CODE_BY_LABEL[label]].contains.length);
  const mayContainLabels = ALLERGEN_LABELS.filter(label => evidenceByCode[ALLERGEN_CODE_BY_LABEL[label]].mayContain.length);
  const assessments = ALLERGEN_LABELS.map(label => {
    const code = ALLERGEN_CODE_BY_LABEL[label];
    const evidence = evidenceByCode[code];
    return {label, code, status: evidence.contains.length ? 'PRESENT' : evidence.mayContain.length ? 'MAY_CONTAIN' : 'UNKNOWN',
      reason: evidence.contains.length ? 'POSITIVE_EVIDENCE' : evidence.mayContain.length ? 'PRECAUTION_ONLY' : unknownIngredients.length ? 'INCOMPLETE_COMPOSITION' : 'NO_POSITIVE_EVIDENCE',
      conflict: Boolean(evidence.contains.length && evidence.claims.length)};
  });
  return {ruleVersion: ALLERGEN_RULE_VERSION, labels, codes: labels.map(label => ALLERGEN_CODE_BY_LABEL[label]),
    evidence: Object.fromEntries(labels.map(label => [label, evidenceByCode[ALLERGEN_CODE_BY_LABEL[label]].contains[0].text])),
    mayContainLabels, mayContainCodes: mayContainLabels.map(label => ALLERGEN_CODE_BY_LABEL[label]),
    unknownIngredients, evidenceByCode, assessments,
    // Ingredient use does not establish the finished product's SO2 residue level.
    sulfiteThresholdStatus: evidenceByCode.SULFITES.contains.length ? 'NOT_ASSESSED_REQUIRES_FINAL_SO2' : 'UNKNOWN'};
}

export function deriveAllergens(ingredientNames = []) {
  return assessAllergens({ingredients: ingredientNames});
}
export function matchesAllergen(label, ingredientName) {
  return deriveAllergens([ingredientName]).labels.includes(label);
}

// Absence of a new match, a negative claim or a substring collision cannot delete
// previous evidence. This planner is pure and never writes to a database itself.
export function planAllergenUpdate(existingLabels, assessment) {
  const existing = new Set(existingLabels);
  const merged = new Set([...existingLabels, ...assessment.labels]);
  return {
    labels: ALLERGEN_LABELS.filter(label => merged.has(label)),
    addedLabels: assessment.labels.filter(label => !existing.has(label)),
    removedLabels: [],
    retainedWithoutNewEvidence: existingLabels.filter(label => ALLERGEN_LABELS.includes(label) && !assessment.labels.includes(label)),
  };
}

// Diagnostic only. A collision cannot prove that an existing stored flag is false.
export const COLLISION_CORRECTIONS = {
  밀: ['메밀', '모밀', '밀크', '호밀', '아밀라'], 쇠고기: ['염소'],
  조개류: ['덩굴', '둥굴', '굴비'], 게: ['스파게티', '성게', '멍게', '게피'], 돼지고기: ['돼지감자'],
};
export function findCollisionEvidence(label, ingredientNames = []) {
  const words = COLLISION_CORRECTIONS[label] || [];
  return ingredientNames.find(name => words.some(word => normalizeIngredientName(name).includes(word))) ?? null;
}
