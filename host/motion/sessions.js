/**
 * Motion session admission — view lease / epoch / selection / time-range validation.
 * Uses the SAME currentDesignScope from client (via execution.agent.session on the host
 * side) but maintains its own project/viewEpoch/lease/selection/time-range namespace.
 * Never adds "motion" to the native engine enum; never falls back to global chat.
 */
import crypto from 'node:crypto';
import { validateProjectId, validateRevision, validateHfIdSet, validateTimeRange, SchemaError } from './schema.js';

const leases = new Map(); // leaseId → { projectId, sessionId, viewEpoch, baseRevision, selectionStamp, createdAt, lastSeenAt, revoked }

export function mintLease({ projectId, sessionId, baseRevision, viewEpoch }) {
	validateProjectId(projectId);
	if (!sessionId || typeof sessionId !== 'string') throw new SchemaError('E_SESSION', 'execution agent session required');
	if (!viewEpoch || typeof viewEpoch !== 'string') throw new SchemaError('E_EPOCH', 'viewEpoch required');
	validateRevision(baseRevision);
	const leaseId = crypto.randomBytes(24).toString('base64url');
	const lease = { leaseId, projectId, sessionId, baseRevision, viewEpoch, selectionStamp: null, timeRange: null, createdAt: new Date().toISOString(), lastSeenAt: new Date().toISOString(), revoked: false };
	leases.set(leaseId, lease);
	return lease;
}

export function getLease(leaseId) {
	return leases.get(leaseId) || null;
}

export function revokeLease(leaseId) {
	const lease = leases.get(leaseId);
	if (lease) lease.revoked = true;
}

export function revokeProjectLeases(projectId) {
	for (const [, lease] of leases) if (lease.projectId === projectId) lease.revoked = true;
}

export function validateLease(leaseId, { projectId, sessionId, baseRevision, viewEpoch }) {
	const lease = typeof leaseId === 'string' ? leases.get(leaseId) : null;
	if (!lease) throw new SchemaError('E_LEASE', 'unknown lease');
	if (lease.revoked) throw new SchemaError('E_LEASE_REVOKED', 'lease revoked');
	if (projectId && lease.projectId !== projectId) throw new SchemaError('E_LEASE_PROJECT', 'lease projectId mismatch');
	if (sessionId && lease.sessionId !== sessionId) throw new SchemaError('E_LEASE_SESSION', 'lease sessionId mismatch');
	if (viewEpoch && lease.viewEpoch !== viewEpoch) throw new SchemaError('E_LEASE_EPOCH', 'stale viewEpoch');
	if (baseRevision && lease.baseRevision !== baseRevision) throw new SchemaError('E_LEASE_STALE', 'stale baseRevision');
	lease.lastSeenAt = new Date().toISOString();
	return lease;
}

export function updateLeaseSelection(leaseId, { selectionStamp, hfIds, timeRange, baseRevision }) {
	const lease = validateLease(leaseId, { baseRevision });
	if (hfIds !== undefined) { validateHfIdSet(hfIds); lease.selectionStamp = crypto.createHash('sha256').update(JSON.stringify(hfIds)).digest('hex').slice(0, 16); }
	if (timeRange !== undefined) { validateTimeRange(timeRange, { durationFrames: timeRange.durationFrames }); lease.timeRange = timeRange; }
	return lease;
}

/** Admission check for a write operation. Throws on any mismatch. */
export function admitWrite({ leaseId, sessionId, projectId, baseRevision, viewEpoch, selectionStamp }) {
	const lease = validateLease(leaseId, { projectId, sessionId, viewEpoch });
	validateRevision(baseRevision);
	if (baseRevision !== lease.baseRevision) throw new SchemaError('E_STALE_BASE', 'caller baseRevision != lease baseRevision');
	if (selectionStamp && lease.selectionStamp && selectionStamp !== lease.selectionStamp) {
		throw new SchemaError('E_SELECTION_CHANGED', 'selection changed since lease; re-select and retry');
	}
	return lease;
}

/** Garbage-collect leases older than 4h. */
export function gcLeases() {
	const cutoff = Date.now() - 4 * 3600 * 1000;
	for (const [id, lease] of leases) if (new Date(lease.createdAt).getTime() < cutoff) leases.delete(id);
}
setInterval(() => gcLeases(), 300000).unref();
