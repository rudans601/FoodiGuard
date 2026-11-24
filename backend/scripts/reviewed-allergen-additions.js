// Bounded additive operation. The caller owns the transaction and target identity.
// No environment, credentials or network are loaded by this module.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { assessAllergens, ALLERGEN_CODE_BY_LABEL } from '../server/allergens.js';

const labels = Object.fromEntries(Object.entries(ALLERGEN_CODE_BY_LABEL).map(([label, code]) => [code, label]));
export const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export async function readReviewedState(db, ids) {
  const result = {};
  for (const [key, table, column, order] of [
    ['products', 'food_products', 'id', 'id'],
    ['ingredients', 'food_ingredients', 'food_id', 'food_id, ordinal, id'],
    ['allergens', 'food_allergens', 'food_id', 'food_id, allergen_code, presence_status, id'],
  ]) {
    result[key] = (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE ${column} = ANY($1::bigint[]) ORDER BY ${order}`, [ids])).rows.map(r => r.row);
  }
  return result;
}

export function prepareReviewedAdditions(reviewed, snapshot, current) {
  const originalById = new Map(snapshot.map(p => [String(p.id), p]));
  const productById = new Map(current.products.map(p => [String(p.id), p]));
  assert.equal(productById.size, reviewed.length, 'Missing or duplicate reviewed products');
  const additions = [];
  for (const review of reviewed) {
    const id = String(review.id);
    const original = originalById.get(id);
    const product = productById.get(id);
    assert.ok(original && product, `Missing product ${id}`);
    assert.equal(product.name, original.name, `Name changed: ${id}`);
    assert.equal(product.report_no, original.report_no, `Report number changed: ${id}`);
    const ingredients = current.ingredients.filter(r => String(r.food_id) === id);
    assert.deepEqual(ingredients.map(r => r.ingredient_name), original.ingredients, `Recipe changed: ${id}`);
    if (original.ingredient_rows) {
      const identity = ingredients.map(r => ({id:String(r.id),source_row_id:String(r.source_row_id),ordinal:String(r.ordinal),ingredient_name:r.ingredient_name}));
      assert.deepEqual(identity, original.ingredient_rows, `Ingredient identity/order changed: ${id}`);
    }
    const assessment = assessAllergens({ ingredients: ingredients.map(r => r.ingredient_name) });
    const stored = new Set([
      ...(product.allergen_codes || []).map(label => ALLERGEN_CODE_BY_LABEL[label] || label),
      ...current.allergens.filter(r => String(r.food_id) === id && r.presence_status === 'PRESENT').map(r => r.allergen_code),
    ]);
    for (const code of review.newVsStored) {
      assert.ok(labels[code] && assessment.codes.includes(code), `Unconfirmed positive evidence: ${id}/${code}`);
      assert.ok(!assessment.assessments.find(a => a.code === code).conflict, `Conflicting evidence: ${id}/${code}`);
      if (stored.has(code)) continue;
      const evidence = assessment.evidenceByCode[code].contains[0];
      const ingredient = ingredients.find(r => r.ingredient_name === evidence.text);
      assert.ok(ingredient, `Missing source ingredient: ${id}/${code}`);
      additions.push({ food_id: id, code, label: labels[code], evidence_ingredient_id: String(ingredient.id), evidence });
    }
  }
  assert.equal(new Set(additions.map(r => `${r.food_id}/${r.code}`)).size, additions.length);
  return { beforeDigest: digest(current), additions };
}

export async function writeReviewedAdditions(db, plan, before) {
  assert.equal(digest(before), plan.beforeDigest, 'Current data differ from reviewed backup');
  if (!plan.additions.length) return { inserted: [], products: [] };
  const inserted = await db.query(`
    INSERT INTO food_allergens (food_id, allergen_code, presence_status, evidence_ingredient_id)
    SELECT food_id::bigint, code, 'PRESENT', evidence_ingredient_id::bigint
    FROM jsonb_to_recordset($1::jsonb) AS p(food_id text, code varchar, evidence_ingredient_id text)
    RETURNING id, food_id, allergen_code, presence_status, evidence_ingredient_id`, [JSON.stringify(plan.additions)]);
  assert.equal(inserted.rows.length, plan.additions.length, 'Unexpected insert count');
  const byId = new Map();
  for (const item of plan.additions) {
    if (!byId.has(item.food_id)) byId.set(item.food_id, []);
    byId.get(item.food_id).push(item.label);
  }
  const updates = [...byId].map(([id, added]) => {
    const previous = before.products.find(p => String(p.id) === id);
    return { id, labels: [...new Set([...(previous.allergen_codes || []), ...added])] };
  });
  const changed = await db.query(`
    UPDATE food_products p SET allergen_codes = v.labels, updated_at = now()
    FROM jsonb_to_recordset($1::jsonb) AS v(id bigint, labels varchar[])
    WHERE p.id = v.id RETURNING p.id, p.allergen_codes`, [JSON.stringify(updates)]);
  assert.equal(changed.rows.length, updates.length, 'Unexpected updated product count');
  return { inserted: inserted.rows, products: changed.rows };
}
