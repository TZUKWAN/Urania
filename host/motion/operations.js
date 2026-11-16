/**
 * Motion operations — durable, idempotent operation records.
 * Layout: <projectDir>/design/.designcraft/motion/operations/<operationKey>.json
 * Contract (MV1-05):
 *   - record persisted BEFORE execution starts
 *   - same key + same input digest → return original receipt (idempotent)
 *   - same key + different input digest → 409 refused
 *   - status distinguishes: running / succeeded / failed / interrupted
 *   - host restart can read the records (they live on disk)
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateOperationKey, SchemaError } from './schema.js';

const digest = (input) => crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex');

export class OperationError extends Error {
	constructor(code, message, status = 409) { super(message); this.code = code; this.status = status; }
}

function opsDir(root) { return path.join(root, 'design', '.designcraft', 'motion', 'operations'); }
function opPath(root, key) { return path.join(opsDir(root), key + '.json'); }

export function inputDigest(input) { return digest(input); }

/**
 * Claim an operation slot. Returns { status: 'new'|'existing', receipt }.
 * Caller runs the work and calls completeOperation / failOperation.
 */
export function claimOperation(root, operationKey, inputDigestHex) {
	validateOperationKey(operationKey);
	if (!inputDigestHex || !/^[0-9a-f]{64}$/.test(inputDigestHex)) throw new OperationError('E_DIGEST', 'input digest required');
	const file = opPath(root, operationKey);
	if (fs.existsSync(file)) {
		const record = JSON.parse(fs.readFileSync(file, 'utf8'));
		if (record.inputDigest !== inputDigestHex) throw new OperationError('E_KEY_CONFLICT', 'same operationKey with different input; refusing', 409);
		return { status: 'existing', receipt: record };
	}
	const record = {
		operationKey, inputDigest: inputDigestHex,
		status: 'running', startedAt: new Date().toISOString(),
		receipt: null, finishedAt: null
	};
	fs.mkdirSync(opsDir(root), { recursive: true });
	const tmp = file + '.tmp-' + crypto.randomBytes(6).toString('hex');
	fs.writeFileSync(tmp, JSON.stringify(record, null, 1));
	fs.renameSync(tmp, file);
	return { status: 'new', receipt: record };
}

export function completeOperation(root, operationKey, receipt) {
	const file = opPath(root, operationKey);
	if (!fs.existsSync(file)) throw new OperationError('E_NO_OP', 'operation not claimed: ' + operationKey, 404);
	const record = JSON.parse(fs.readFileSync(file, 'utf8'));
	record.status = 'succeeded';
	record.receipt = receipt;
	record.finishedAt = new Date().toISOString();
	fs.writeFileSync(file, JSON.stringify(record, null, 1));
	return record;
}

export function failOperation(root, operationKey, error) {
	const file = opPath(root, operationKey);
	if (!fs.existsSync(file)) throw new OperationError('E_NO_OP', 'operation not claimed: ' + operationKey, 404);
	const record = JSON.parse(fs.readFileSync(file, 'utf8'));
	record.status = 'failed';
	record.error = String(error && error.message || error).slice(0, 500);
	record.finishedAt = new Date().toISOString();
	fs.writeFileSync(file, JSON.stringify(record, null, 1));
	return record;
}

export function getOperation(root, operationKey) {
	validateOperationKey(operationKey);
	const file = opPath(root, operationKey);
	if (!fs.existsSync(file)) throw new OperationError('E_NO_OP', 'operation not found: ' + operationKey, 404);
	return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** Wrap a synchronous/async executor with claim→run→complete/fail. Returns {receipt, replayed} */
export async function withOperation(root, operationKey, input, executor) {
	const claim = claimOperation(root, operationKey, inputDigest(input));
	if (claim.status === 'existing' && claim.receipt.status === 'succeeded') {
		return { receipt: claim.receipt.receipt, replayed: true };
	}
	if (claim.status === 'existing' && claim.receipt.status === 'running') {
		// previous run died mid-flight; allow retry (overwrite running record)
	}
	try {
		const receipt = await executor();
		completeOperation(root, operationKey, receipt);
		return { receipt, replayed: false };
	} catch (error) {
		failOperation(root, operationKey, error);
		throw error;
	}
}
