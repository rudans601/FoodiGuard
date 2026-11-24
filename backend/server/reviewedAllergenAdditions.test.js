import assert from 'node:assert/strict';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { readReviewedState, prepareReviewedAdditions, writeReviewedAdditions } from '../scripts/reviewed-allergen-additions.js';

test('reviewed additions preserve old and precaution evidence, reject changed recipes, and roll back on failure', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE TABLE food_products(id bigint PRIMARY KEY, name text, report_no text, allergen_codes varchar[], updated_at timestamptz);
      CREATE TABLE food_ingredients(id bigint PRIMARY KEY, food_id bigint, ordinal int, ingredient_name text);
      CREATE TABLE food_allergens(id bigserial PRIMARY KEY, food_id bigint, allergen_code varchar, presence_status varchar,
        evidence_ingredient_id bigint REFERENCES food_ingredients(id), UNIQUE(food_id,allergen_code,presence_status));
      INSERT INTO food_products VALUES(1,'검토 상품','R1',ARRAY['돼지고기'],'2020-01-01'),(2,'다른 상품','R2',ARRAY[]::varchar[],'2020-01-01');
      INSERT INTO food_ingredients VALUES(10,1,1,'서리태'),(11,1,2,'소스'),(12,2,1,'우유');
      INSERT INTO food_allergens(food_id,allergen_code,presence_status) VALUES(1,'PORK','PRESENT'),(1,'MILK','MAY_CONTAIN');
    `);
    const review = [{id:'1', newVsStored:['SOY']}];
    const snapshot = [{id:'1',name:'검토 상품',report_no:'R1',ingredients:['서리태','소스']}];
    const before = await readReviewedState(db, ['1']);
    const plan = prepareReviewedAdditions(review, snapshot, before);
    assert.equal(plan.additions.length, 1);
    assert.equal(plan.additions[0].evidence_ingredient_id, '10');
    assert.throws(() => prepareReviewedAdditions(review, snapshot, {...before, ingredients:[{...before.ingredients[0],ingredient_name:'완두콩'}, before.ingredients[1]]}), /Recipe changed/);
    assert.throws(() => prepareReviewedAdditions([{id:'1',newVsStored:['MILK']}], snapshot, before), /Unconfirmed/);
    await assert.rejects(writeReviewedAdditions(db, plan, {...before, allergens:[]}), /differ/);
    await db.exec(`CREATE FUNCTION reject_update() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'fixture failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER reject_update BEFORE UPDATE ON food_products FOR EACH ROW EXECUTE FUNCTION reject_update();`);
    await db.exec('BEGIN');
    await assert.rejects(writeReviewedAdditions(db, plan, before), /fixture failure/);
    await db.exec('ROLLBACK');
    assert.deepEqual(await readReviewedState(db,['1']), before, 'failed update must also roll back inserted allergen');
    await db.exec('DROP TRIGGER reject_update ON food_products');
    await db.exec('BEGIN');
    const result = await writeReviewedAdditions(db, plan, before);
    await db.exec('COMMIT');
    assert.equal(result.inserted.length, 1);
    const after = await readReviewedState(db, ['1']);
    assert.deepEqual(after.products[0].allergen_codes, ['돼지고기','대두']);
    assert.deepEqual(after.allergens.filter(r => r.allergen_code !== 'SOY'), before.allergens);
    assert.deepEqual((await db.query('SELECT allergen_codes FROM food_products WHERE id=2')).rows[0].allergen_codes, []);
    assert.equal(prepareReviewedAdditions(review, snapshot, after).additions.length, 0, 'already-applied evidence must not duplicate');
  } finally { await db.close(); }
});
