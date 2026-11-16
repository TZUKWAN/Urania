/** MV1-05 — operations: idempotency, key conflict, crash recovery. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { withOperation, getOperation, OperationError } from '../host/motion/operations.js';

const ROOT = fs.mkdtempSync(path.join(process.env.TEMP || '/tmp', 'dc-motion-ops-'));

test('first run executes and persists receipt', async () => {
	const { receipt, replayed } = await withOperation(ROOT, 'op-create-1', { a: 1 }, () => ({ revision: 'abc' }));
	assert.equal(replayed, false);
	assert.equal(receipt.revision, 'abc');
	const record = getOperation(ROOT, 'op-create-1');
	assert.equal(record.status, 'succeeded');
});
test('same key + same input → replayed receipt, no second execution', async () => {
	let calls = 0;
	const { receipt, replayed } = await withOperation(ROOT, 'op-create-1', { a: 1 }, () => { calls++; return { revision: 'abc' }; });
	assert.equal(replayed, true);
	assert.equal(calls, 0);
	assert.equal(receipt.revision, 'abc');
});
test('same key + different input → 409', async () => {
	await assert.rejects(() => withOperation(ROOT, 'op-create-1', { a: 2 }, () => ({})), (e) => e instanceof OperationError && e.status === 409);
});
test('failed operation records error', async () => {
	await assert.rejects(() => withOperation(ROOT, 'op-fail-1', { b: 1 }, () => { throw new Error('intentional'); }), /intentional/);
	const record = getOperation(ROOT, 'op-fail-1');
	assert.equal(record.status, 'failed');
	assert.ok(record.error.includes('intentional'));
});
test('failed operation retried → runs again', async () => {
	const { receipt } = await withOperation(ROOT, 'op-fail-1', { b: 1 }, () => ({ recovered: true }));
	assert.equal(receipt.recovered, true);
	const record = getOperation(ROOT, 'op-fail-1');
	assert.equal(record.status, 'succeeded');
});
test('running operation survives "restart" (record on disk)', async () => {
	// simulate: claim then abandon
	await withOperation(ROOT, 'op-running-1', { c: 1 }, () => { throw Object.assign(new Error('simulated crash'), { recovered: true }); }).catch(() => {});
	const record = getOperation(ROOT, 'op-running-1');
	assert.ok(record.status === 'failed' || record.status === 'running');
	// after "restart" the record is still queryable
	const again = getOperation(ROOT, 'op-running-1');
	assert.equal(again.operationKey, 'op-running-1');
});
