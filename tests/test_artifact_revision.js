import assert from 'node:assert/strict';
import test from 'node:test';

import { artifactRevision } from '../ops/data/artifact-revision.mjs';

test('artifact identity changes when code changes even if catalog data is unchanged', () => {
  const data = 'a'.repeat(20);
  const first = artifactRevision(data, 'b'.repeat(40));
  const second = artifactRevision(data, 'c'.repeat(40));
  assert.match(first, /^[a-f0-9]{20}$/);
  assert.notEqual(first, second);
  assert.equal(first, artifactRevision(data, 'b'.repeat(40)));
});
