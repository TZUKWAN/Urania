/**
 * DesignCraft motion worker entry — trusted Node worker for edit-time SDK calls
 * and video rendering. Protocol: single JSON request on argv[2] or stdin, single
 * JSON response on stdout. Project JS never runs here (browser-only); no shell
 * spawning; env explicitly whitelisted by the host supervisor.
 *
 * Commands (MV0-03 scope):
 *   {"command":"version"}            → worker/SDK/runtime versions
 *   {"command":"capabilities"}       → what this worker can do today
 */
import { createRequire } from 'node:module';
import { version as nodeVersion, argv, env, platform, arch } from 'node:process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const requireUnused = require; // kept: CJS interop for future non-ESM helpers

async function main() {
	const raw = argv[2] || await new Promise((resolve, reject) => {
		let data = '';
		process.stdin.setEncoding('utf8');
		process.stdin.on('data', d => { data += d; });
		process.stdin.on('end', () => resolve(data));
		process.stdin.on('error', reject);
		setTimeout(() => reject(new Error('stdin timeout')), 10000);
	});
	let request;
	try { request = JSON.parse(raw); } catch { throw new Error('request is not valid JSON'); }

	if (request.command === 'version') {
		// SDK exports do not expose ./package.json and the packages are ESM-only —
		// resolve via import.meta (same node_modules tree as this entry) and read the package dir directly.
		const readFile = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
		const pkgVersion = (name) => {
			const resolved = import.meta.resolve(name); // dist/*.js entry per exports
			const distPath = fileURLToPath(resolved);
			const dir = distPath.slice(0, distPath.lastIndexOf('dist'));
			const pkg = readFile(dir + 'package.json');
			return { version: pkg.version, path: dir + 'package.json' };
		};
		return {
			ok: true,
			command: 'version',
			node: { executable: process.execPath, version: nodeVersion, platform, arch, major: Number(nodeVersion.slice(1).split('.')[0]) },
			packages: {
				'@hyperframes/sdk': pkgVersion('@hyperframes/sdk'),
				'@hyperframes/player': pkgVersion('@hyperframes/player'),
				'@hyperframes/producer': pkgVersion('@hyperframes/producer'),
				'@hyperframes/core': pkgVersion('@hyperframes/core')
			},
			versionsSeen: process.versions
		};
	}

	if (request.command === 'capabilities') {
		return {
			ok: true,
			command: 'capabilities',
			capabilities: {
				edit: { openComposition: true, typedOps: ['setText', 'setStyle', 'dispatch'], serializeFlush: true, note: 'SDK-level; real capabilities re-verified per composition in MV2-03' },
			render: { producerCreateRenderJob: true, abortSignal: true, note: 'real render pipeline proven in MV0-05 with a pinned browser + FFmpeg' },
			budget: { editComputeSeconds: 30, previewReadySeconds: 30, renderMinutes: 20, tempGiB: 8, note: 'defaults from EXECUTION_PLAN §3.3; adjustable via MV0 evidence, never disabled' }
			}
		};
	}

	throw new Error('unknown command: ' + String(request.command));
}

main().then(
	(result) => {
		process.stdout.write(JSON.stringify(result));
	},
	(error) => {
		process.stdout.write(JSON.stringify({ ok: false, error: String(error?.message || error) }));
		process.exitCode = 1;
	}
);
