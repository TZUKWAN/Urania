/**
 * Motion reference — model-readable context for the current animation state.
 * Sent alongside AI requests so the model knows what it's editing.
 */
export function buildMotionReference({ projectId, revision, leaseId, currentFrame, fps, durationFrames, selectedIds, timeRange, sourceTypes }) {
	return {
		schemaVersion: 1,
		type: 'motion',
		projectId,
		revision,
		leaseId,
		currentFrame,
		fps,
		durationFrames,
		currentTime: +(currentFrame / fps).toFixed(3),
		selectedIds: selectedIds || [],
		timeRange: timeRange || null,
		sourceTypes: sourceTypes || 'html'
	};
}

/** Normalize a motion project state from the store. */
export function normalizeMotionProject(raw) {
	if (!raw || typeof raw !== 'object') return null;
	return {
		projectId: raw.projectId || null,
		revision: raw.revision || null,
		leaseId: raw.leaseId || null,
		viewEpoch: raw.viewEpoch || null,
		title: raw.title || '未命名动画',
		currentFrame: raw.currentFrame || 0,
		fps: raw.fps || { num: 30, den: 1 },
		durationFrames: raw.durationFrames || 120,
		selectedIds: raw.selectedIds || [],
		sources: raw.sources || {},
		previewUrl: raw.previewUrl || null,
		renderStatus: raw.renderStatus || null
	};
}
