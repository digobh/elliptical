import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeError } from '../src/errors.js';

test('describeError handles odd rejection values', () => {
  assert.equal(describeError(undefined), 'empty rejection (undefined)');
  assert.equal(describeError(null), 'empty rejection (null)');
  assert.equal(describeError('User cancelled'), 'User cancelled');
  assert.equal(describeError(new DOMException('nope', 'NotFoundError')), 'NotFoundError: nope');
  assert.equal(describeError({ foo: 1 }), '{"foo":1}');
});
