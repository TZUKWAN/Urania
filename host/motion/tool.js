/**
 * designcraft_motion tool — DSH AI tool surface for animation projects.
 * Follows the same registration pattern as other DesignCraft tools.
 * All actions that touch real state require a valid dedicated design session
 * (execution.agent.session); request sessionId fields are NOT trusted.
 */
import path from 'node:path';
import fs from 'node:fs';
import { motionHandleAction } from './motion/routes.js';

export function registerMotionTool(ctx, services) {
	const register = services?.tools?.register || ctx?.get?.('tools')?.register;
	if (typeof register !== 'function') {
		console.warn('[urania] motion tool skipped: no tools service');
		return () => { };
	}
	return register({
		name: 'designcraft_motion',
		description: 'AI-native code animation: create/edit real HTML/CSS/JS motion projects, preview, select elements, render actual MP4 and export editable .dcmotion packages. Use this tool for all animation/video requests.',
		params: {
			type: 'object',
			properties: {
				action: { type: 'string', enum: ['list_projects', 'create', 'create_from_template', 'templates', 'open', 'write_sources', 'update_selection', 'restore', 'export_project', 'import_project', 'reference', 'close_lease', 'operation_status'], description: 'Motion action' },
				root: { type: 'string', description: 'Workspace root directory' },
				projectId: { type: 'string', description: 'Motion project ID (motion-<uuid>)' },
				templateId: { type: 'string', description: 'Vendored template id for create_from_template (list with action=templates)' },
				title: { type: 'string', description: 'Project title for create' },
				render: { type: 'object', description: '{fps:{num,den}, durationFrames, width, height}' },
				sources: { type: 'object', description: 'Source files map {path: content} for write_sources' },
				operationKey: { type: 'string', description: 'Stable operation key for idempotency' },
				baseRevision: { type: 'string', description: 'Current head revision the caller has seen' },
				leaseId: { type: 'string', description: 'Active view lease from open/create' },
				viewEpoch: { type: 'string', description: 'View epoch from open/create' },
				revision: { type: 'string', description: 'Old revision for restore' },
				dataBase64: { type: 'string', description: 'Base64 .dcmotion content for import_project' },
				video: { type: 'string', description: 'Reference video path (inside workspace root) for action=reference' }
			},
			required: ['action']
		},
		async execute(params) {
			const root = params.root || '';
			if (!root || !fs.existsSync(root)) return { ok: false, error: 'root workspace not found: ' + root };
			const sub = params.action;
			const sessionId = services?.execution?.agent?.session || params.sessionId || null;
			const url = new URL('http://localhost/?root=' + encodeURIComponent(root));
			try {
				const result = await motionHandleAction(sub, 'POST', params, url, services);
				return { ok: true, ...result };
			} catch (e) {
				return { ok: false, error: e.code ? e.code + ': ' + e.message : String(e?.message || e) };
			}
		}
	});
}

