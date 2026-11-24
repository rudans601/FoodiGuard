import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { ALLERGEN_LABELS, ALLERGEN_CODE_BY_LABEL, assessAllergens, deriveAllergens, matchesAllergen, planAllergenUpdate } from './allergens.js';

// Expectations fixed by the prior review, before the implementation was changed.
const reviewed = JSON.parse(fs.readFileSync(new URL('./fixtures/allergen-reviewed-cases.json', import.meta.url)));
for (const item of reviewed) {
  test(`reviewed ${item.label}: ${item.input}`, () => {
    assert.equal(matchesAllergen(item.label, item.input), item.expected_flag);
  });
}

// Previously visually checked label lists, not raw OCR output or current DB truth.
const reviewedLabels = JSON.parse(fs.readFileSync(new URL('./fixtures/allergen-reviewed-labels.json', import.meta.url)));
for (const row of reviewedLabels) {
  test(`reviewed label fields stay separate: ${row.id} ${row.name}`, () => {
    const codeForLabel = label => {
      const base = label.replace(/\(.*\)/, '');
      const alias = {알류:'난류', 계란:'난류', 달걀:'난류', 소고기:'쇠고기', 이산화황:'아황산류'};
      return ALLERGEN_CODE_BY_LABEL[alias[base] || base];
    };
    const expectedContains = [...new Set(row.accepted_contains.map(codeForLabel))].sort();
    const expectedPrecaution = [...new Set(row.accepted_precaution.map(codeForLabel))].sort();
    assert.ok(!expectedContains.includes(undefined) && !expectedPrecaution.includes(undefined));
    const actual = assessAllergens({allergenStatements:[row.accepted_contains.join(', ') + ' 함유'],
      precautionStatements:[row.accepted_precaution.join(', ') + '을 사용한 제품과 같은 제조시설에서 제조']});
    assert.deepEqual([...actual.codes].sort(), expectedContains);
    assert.deepEqual([...actual.mayContainCodes].sort(), expectedPrecaution);
  });
}

for (const label of ALLERGEN_LABELS) {
  const code = ALLERGEN_CODE_BY_LABEL[label];
  const term = label === '난류' ? '계란' : label;
  for (const warning of [`${term} 혼입 가능`, `${term}을 사용한 제품과 같은 제조시설에서 제조`, `${term}이 함유될 수 있음`]) {
    test(`precaution ${code}: ${warning}`, () => {
      const result = deriveAllergens([warning]);
      assert.equal(result.codes.includes(code), false);
      assert.ok(result.mayContainCodes.includes(code));
      assert.equal(result.assessments.find(a => a.code === code).status, 'MAY_CONTAIN');
    });
  }
  test(`negative claims never establish absence ${code}`, () => {
    const result = assessAllergens({allergenStatements: [`${term} 무첨가`]});
    assert.equal(result.codes.includes(code), false);
    assert.equal(result.assessments.find(a => a.code === code).status, 'UNKNOWN');
    assert.ok(result.evidenceByCode[code].claims.length);
  });
  test(`positive evidence survives precaution and a contradictory claim ${code}`, () => {
    const result = assessAllergens({ingredients: [term, '소스'], allergenStatements: [`${term} 무첨가`], precautionStatements: [term]});
    assert.ok(result.codes.includes(code));
    assert.ok(result.mayContainCodes.includes(code));
    assert.ok(result.assessments.find(a => a.code === code).conflict);
    assert.equal(result.assessments.length, 19);
  });
  test(`existing ${code} is never removed without evidence verification`, () => {
    const plan = planAllergenUpdate([label], deriveAllergens(['소스', '메밀가루', '돼지감자']));
    assert.ok(plan.labels.includes(label));
    assert.deepEqual(plan.removedLabels, []);
  });
}

test('opaque ingredients remain unresolved for all 19; an empty result never means safe', () => {
  for (const raw of ['소스', '분말스프', '복합조미식품', '식물성크림', '젤라틴', '사골육수', '간장', '활성글루텐', '땅콩 또는 견과류가공품', '두부류또는묵류', '버터향', '나무토마토열매']) {
    const result = deriveAllergens([raw]);
    assert.deepEqual(result.codes, [], raw);
    assert.ok(result.unknownIngredients.length, raw);
    assert.ok(result.assessments.every(a => a.status === 'UNKNOWN'), raw);
  }
  assert.ok(deriveAllergens([]).assessments.every(a => a.status === 'UNKNOWN'));
});

test('independent clauses preserve presence, precaution and claims', () => {
  for (const separator of [', ', '; ', '. ', '\n']) {
    const result = deriveAllergens([`우유 함유${separator}메밀 혼입 가능${separator}땅콩 무첨가`]);
    assert.deepEqual(result.codes, ['MILK']);
    assert.deepEqual(result.mayContainCodes, ['BUCKWHEAT']);
    assert.ok(result.evidenceByCode.PEANUT.claims.length);
  }
  const reversed = deriveAllergens(['메밀 혼입 가능, 우유 함유']);
  assert.deepEqual(reversed.codes, ['MILK']);
  assert.deepEqual(reversed.mayContainCodes, ['BUCKWHEAT']);
});

test('labels and wrapped warnings use their own scope', () => {
  const result = assessAllergens({ingredients: ['소스'], allergenStatements: ['우유, 대두 함유'], precautionStatements: ['메밀,\n땅콩을 사용한 제품과 같은 제조시설에서 제조']});
  assert.deepEqual(result.codes, ['MILK', 'SOY']);
  assert.deepEqual(result.mayContainCodes, ['BUCKWHEAT', 'PEANUT']);
  assert.ok(result.unknownIngredients.some(e => e.text === '소스'));
});

test('nested evidence remains positive despite unknown parent and unrelated collision', () => {
  const result = deriveAllergens(['소스[버터향(탈지분유), 메밀가루, 밀가루, 돼지감자, 식용돈지]']);
  assert.deepEqual(result.codes, ['MILK', 'BUCKWHEAT', 'WHEAT', 'PORK']);
  assert.ok(result.unknownIngredients.some(e => e.reason === 'FLAVOUR_COMPOSITION_UNKNOWN'));
  assert.ok(result.unknownIngredients.some(e => e.reason === 'COMPOUND_COMPOSITION_UNVERIFIED'));
});

test('malformed OCR remains unresolved and valid explicit evidence is retained', () => {
  const result = deriveAllergens(['소스(우유, 밀가루']);
  assert.deepEqual(result.codes, ['MILK', 'WHEAT']);
  assert.ok(result.unknownIngredients.some(e => e.reason === 'MALFORMED_BRACKETS'));
});

test('a local free-from claim cannot cancel another ingredient', () => {
  for (const input of ['소스(우유, 글루텐프리전분)', '우유, 글루텐프리전분', '소스[우유, 분말(밀 무첨가)], 대두유']) {
    assert.ok(deriveAllergens([input]).codes.includes('MILK'), input);
  }
  const warning = deriveAllergens(['우유, 소스(메밀, 땅콩 혼입 가능)']);
  assert.deepEqual(warning.codes, ['MILK']);
  assert.deepEqual(warning.mayContainCodes, ['BUCKWHEAT', 'PEANUT']);
});

test('SO2 residue is not inferred from an ingredient name', () => {
  const result = deriveAllergens(['아황산나트륨']);
  assert.deepEqual(result.codes, ['SULFITES']);
  assert.equal(result.sulfiteThresholdStatus, 'NOT_ASSESSED_REQUIRES_FINAL_SO2');
});

test('input contract rejects character iteration and objects', () => {
  assert.throws(() => assessAllergens({ingredients: '우유'}), TypeError);
  assert.throws(() => deriveAllergens([{name: '우유'}]), TypeError);
});

test('observed ambiguous trade name and Korean claim variants are not affirmative evidence', () => {
  for (const raw of ['밀크밀', '우유 無첨가', '우유 무 함유', '무우유', '우유 함유 안함']) {
    assert.deepEqual(deriveAllergens([raw]).codes, [], raw);
  }
  assert.deepEqual(deriveAllergens(['우유 무첨가이나 대두 함유']).codes, ['SOY']);
  const mixed = deriveAllergens(['우유 함유하고 있으며, 메밀 혼입 가능']);
  assert.deepEqual(mixed.codes, ['MILK']);
  assert.deepEqual(mixed.mayContainCodes, ['BUCKWHEAT']);
});

test('함유 inside a compound ingredient name is not a complete allergen statement', () => {
  const milk = deriveAllergens(['유함유가공품']);
  assert.deepEqual(milk.codes, ['MILK']);
  assert.equal(milk.evidenceByCode.MILK.contains[0].reason, 'INGREDIENT_SOURCE');
  assert.ok(milk.unknownIngredients.length);
  const meat = deriveAllergens(['식육함유가공품']);
  assert.deepEqual(meat.codes, []);
  assert.ok(meat.unknownIngredients.length);
});
