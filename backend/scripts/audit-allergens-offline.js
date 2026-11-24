// Offline full-population assessment. Imports no DB/client/env/seed module.
// Never accepts --apply. Input snapshots and existing stored flags stay untouched.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { parseArgs } from 'node:util';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { assessAllergens, ALLERGEN_CODE_BY_LABEL, ALLERGEN_LABELS, ALLERGEN_RULE_VERSION, planAllergenUpdate } from '../server/allergens.js';

const {values} = parseArgs({options: {input: {type:'string'}, manifest: {type:'string'}, baseline: {type:'string'}, output: {type:'string'}}});
for (const key of ['input', 'manifest', 'baseline', 'output']) assert.ok(values[key], `Required --${key}`);
const hash = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const manifest = read(values.manifest);
const inputHashBefore = hash(values.input);
assert.equal(inputHashBefore, manifest.inputs_sha256, 'Snapshot hash must match its extraction manifest');
const dumpHashBefore = hash(manifest.source);
assert.equal(dumpHashBefore, manifest.source_sha256, 'Saved DB dump hash must match');
const baseline = await import(pathToFileURL(path.resolve(values.baseline)));
const products = read(values.input);
assert.equal(products.length, manifest.rows.food_products);
assert.equal(new Set(products.map(p => String(p.id))).size, products.length, 'One row per product');
assert.equal(products.reduce((n, p) => n + p.ingredients.length, 0), manifest.rows.food_ingredients);
fs.mkdirSync(values.output, {recursive: true});
const rowsPath = path.join(values.output, 'products.jsonl');
const rowsFile = fs.openSync(rowsPath, 'wx');
const started = Date.now();
const codes = Object.values(ALLERGEN_CODE_BY_LABEL);
const labelByCode = Object.fromEntries(Object.entries(ALLERGEN_CODE_BY_LABEL).map(([label, code]) => [code, label]));
const byCode = Object.fromEntries(codes.map(code => [code, {code, label:labelByCode[code], oldRule:0, stored:0, present:0, mayContain:0, unknown:0, newVsOld:0, notRedetectedVsOld:0, newVsStored:0, storedNeedsReview:0}]));
const counts = {products:0, ingredientRows:0, withoutIngredients:0, withPositiveEvidence:0, withPrecautionEvidence:0,
  withUnresolvedIngredients:0, positiveAndUnresolved:0, positiveWithoutUnresolved:0, noPositiveAndUnresolved:0, noPositiveWithoutUnresolved:0,
  addedVsOldProducts:0, notRedetectedVsOldProducts:0, addedVsStoredProducts:0, storedNeedsReviewProducts:0, conflicts:0,
  storedMayContainProducts:0, storedUnknownProducts:0, plannedRemovals:0, sulfiteResidueUnverified:0};
const unknownCounts = new Map();
const changedTokens = [];
const oldCache = new Map();
const allTokens = [...new Set(products.flatMap(p => p.ingredients))];
for (const token of allTokens) {
  const old = baseline.deriveAllergens([token]).codes;
  oldCache.set(token, old);
  const current = assessAllergens({ingredients:[token]});
  if (JSON.stringify(old) !== JSON.stringify(current.codes)) changedTokens.push({token, old, current:current.codes, unresolved:current.unknownIngredients, products:0});
}
const tokenChangesByName = new Map(changedTokens.map(row => [row.token, row]));
const examples = {added:[], review:[], unresolved:[], precaution:[]};

try {
  for (const product of products) {
    const current = assessAllergens({ingredients:product.ingredients});
    assert.equal(current.assessments.length, 19);
    assert.equal(new Set(current.assessments.map(a => a.code)).size, 19);
    const present = new Set(current.codes);
    const may = new Set(current.mayContainCodes);
    const old = new Set(product.ingredients.flatMap(s => oldCache.get(s)));
    // Stored data are comparison evidence, not ground truth for the new classifier.
    const stored = new Set(product.allergen_rows.filter(r => r.presence_status === 'PRESENT').map(r => r.allergen_code));
    for (const label of (product.allergen_codes || '').replace(/[{}\"]/g, '').split(',')) {
      if (ALLERGEN_CODE_BY_LABEL[label]) stored.add(ALLERGEN_CODE_BY_LABEL[label]);
      else if (codes.includes(label)) stored.add(label);
    }
    assert.ok([...stored].every(code => codes.includes(code)), 'Unexpected stored allergen code');
    const added = [...present].filter(c => !old.has(c));
    const notRedetected = [...old].filter(c => !present.has(c));
    const addedVsStored = [...present].filter(c => !stored.has(c));
    const needsReview = [...stored].filter(c => !present.has(c));
    const plan = planAllergenUpdate([...stored].map(code => labelByCode[code]), current);
    assert.equal(plan.removedLabels.length, 0);
    for (const code of stored) assert.ok(plan.labels.includes(labelByCode[code]));
    const unknown = current.assessments.filter(a => a.status === 'UNKNOWN').map(a => a.code);
    for (const a of current.assessments) {
      assert.ok(['PRESENT', 'MAY_CONTAIN', 'UNKNOWN'].includes(a.status));
      if (a.status === 'PRESENT') assert.ok(current.evidenceByCode[a.code].contains.length);
      if (a.status === 'MAY_CONTAIN') assert.ok(current.evidenceByCode[a.code].mayContain.length);
      if (a.status === 'UNKNOWN') assert.ok(!present.has(a.code) && !may.has(a.code));
      const b = byCode[a.code];
      b.oldRule += Number(old.has(a.code)); b.stored += Number(stored.has(a.code));
      b.present += Number(a.status === 'PRESENT'); b.mayContain += Number(a.status === 'MAY_CONTAIN'); b.unknown += Number(a.status === 'UNKNOWN');
      b.newVsOld += Number(added.includes(a.code)); b.notRedetectedVsOld += Number(notRedetected.includes(a.code));
      b.newVsStored += Number(addedVsStored.includes(a.code)); b.storedNeedsReview += Number(needsReview.includes(a.code));
    }
    counts.products += 1; counts.ingredientRows += product.ingredients.length;
    counts.withoutIngredients += Number(!product.ingredients.length);
    const unresolved = current.unknownIngredients.length > 0;
    counts.withPositiveEvidence += Number(present.size > 0);
    counts.withPrecautionEvidence += Number(may.size > 0);
    counts.withUnresolvedIngredients += Number(unresolved);
    counts[present.size ? unresolved ? 'positiveAndUnresolved' : 'positiveWithoutUnresolved' : unresolved ? 'noPositiveAndUnresolved' : 'noPositiveWithoutUnresolved'] += 1;
    counts.addedVsOldProducts += Number(added.length > 0);
    counts.notRedetectedVsOldProducts += Number(notRedetected.length > 0);
    counts.addedVsStoredProducts += Number(addedVsStored.length > 0);
    counts.storedNeedsReviewProducts += Number(needsReview.length > 0);
    counts.conflicts += Number(current.assessments.some(a => a.conflict));
    counts.sulfiteResidueUnverified += Number(current.codes.includes('SULFITES'));
    counts.storedMayContainProducts += Number(product.allergen_rows.some(r => r.presence_status === 'MAY_CONTAIN'));
    counts.storedUnknownProducts += Number(product.allergen_rows.some(r => r.presence_status === 'UNKNOWN'));
    for (const token of new Set(product.ingredients)) if (tokenChangesByName.has(token)) tokenChangesByName.get(token).products += 1;
    for (const key of new Set(current.unknownIngredients.map(e => `${e.reason}\t${e.token}`))) unknownCounts.set(key, (unknownCounts.get(key) || 0) + 1);
    const row = {id:product.id, name:product.name, reportNo:product.report_no,
      contains:current.codes, mayContain:current.mayContainCodes, unknown, containsEvidence:current.evidence,
      precautionEvidence:Object.fromEntries(current.mayContainCodes.map(code => [code, current.evidenceByCode[code].mayContain])),
      unresolvedIngredients:current.unknownIngredients, storedPresent:[...stored],
      addedVsOldRule:added, notRedetectedVsOldRule:notRedetected, newVsStored:addedVsStored, storedNeedsReview:needsReview,
      sulfiteThresholdStatus:current.sulfiteThresholdStatus};
    fs.writeSync(rowsFile, JSON.stringify(row) + '\n');
    for (const [key, condition] of [['added', addedVsStored.length], ['review', needsReview.length], ['unresolved', !present.size && unresolved], ['precaution', may.size]]) {
      if (condition && examples[key].length < 5) examples[key].push(row);
    }
    if (counts.products % 10000 === 0) process.stderr.write(`Assessed ${counts.products}/${products.length}\n`);
  }
} finally { fs.closeSync(rowsFile); }
assert.equal(hash(values.input), inputHashBefore);
assert.equal(hash(manifest.source), dumpHashBefore);
for (const b of Object.values(byCode)) assert.equal(b.present + b.mayContain + b.unknown, products.length);
assert.equal(counts.positiveAndUnresolved + counts.positiveWithoutUnresolved + counts.noPositiveAndUnresolved + counts.noPositiveWithoutUnresolved, products.length);
const ruleFiles = ['allergens.js', 'allergenRules.js', 'allergenAssessment.js'].map(name => fileURLToPath(new URL(`../server/${name}`, import.meta.url)));
const summary = {ruleVersion:ALLERGEN_RULE_VERSION, snapshotDate:manifest.snapshot_date,
  scope:'All products in the saved snapshot, without additional filters; not a live DB read or current-label verification',
  inputSha256:inputHashBefore, dumpSha256:dumpHashBefore, baselineSha256:hash(values.baseline),
  ruleHashes:Object.fromEntries(ruleFiles.map(file => [path.basename(file), hash(file)])),
  databaseConnections:0, databaseWrites:0, inputUnchanged:true, allProductAllergenPairs:products.length*19,
  durationSeconds:(Date.now()-started)/1000, counts, perAllergen:Object.values(byCode),
  limitations:['No ground truth for all products; counts are evidence classification, not accuracy.',
    'UNKNOWN never means allergen-free. Existing DB flags are retained for review.',
    'No manufacturer labels or cross-contact text are present in this input; lack of warning matches does not prove no cross-contact.',
    'Sulfite residue threshold cannot be determined from ingredient names.'], examples};
fs.writeFileSync(path.join(values.output, 'summary.json'), JSON.stringify(summary,null,2)+'\n');
fs.writeFileSync(path.join(values.output, 'changed-ingredient-rules.json'), JSON.stringify(changedTokens.sort((a,b)=>b.products-a.products),null,2)+'\n');
fs.writeFileSync(path.join(values.output, 'unresolved-ingredients.json'), JSON.stringify([...unknownCounts].map(([key,products])=>{const [reason,token]=key.split('\t');return {reason,token,products};}).sort((a,b)=>b.products-a.products),null,2)+'\n');
process.stdout.write(JSON.stringify({snapshotDate:summary.snapshotDate, counts, allProductAllergenPairs:summary.allProductAllergenPairs, durationSeconds:summary.durationSeconds},null,2)+'\n');
