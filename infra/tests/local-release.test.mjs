import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = name => fs.readFileSync(new URL('../../' + name, import.meta.url), 'utf8');
test('local deployment promotes only after tests and image publication', () => {
  const pipeline = read('Jenkinsfile');
  const stages = ['Test backend', 'Build and publish', 'Publish Helm'].map(name => pipeline.indexOf(name));
  assert.ok(stages[0] >= 0 && stages[0] < stages[1] && stages[1] < stages[2]);
  assert.doesNotMatch(pipeline, /gcloud|pkg\.dev/);
  assert.match(read('local/chart/templates/jobs.yaml'), /argocd\.argoproj\.io\/hook: PreSync/);
  assert.match(read('local/chart/templates/app.yaml'), /API_UPSTREAM, value: "http:\/\/foodiguard-api:8080"/);
});
