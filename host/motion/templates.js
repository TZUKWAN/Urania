/**
 * Motion template library — vendored nexu-io/open-design video templates
 * (Apache-2.0, upstream heygen-com/hyperframes registry; see
 * licenses/MotionTemplates-ATTRIBUTION.md).
 * listTemplates(): metadata + parsed render params from each template.json.
 * templateSources(id): file map (rel -> Buffer) ready to seed a motion project;
 * composition includes are already inlined at vendor time.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TEMPLATES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'resources', 'motion-templates');

function templateDir(id) {
	if (!/^[\w-]+$/.test(id)) return null;
	const dir = path.join(TEMPLATES_DIR, id);
	return fs.existsSync(dir) ? dir : null;
}

function parseRenderFromHtml(html) {
	const grab = (attr) => {
		const m = new RegExp('data-' + attr + '\\s*=\\s*"([0-9.]+)"').exec(html);
		return m ? parseFloat(m[1]) : NaN;
	};
	const durationSec = grab('duration'), width = grab('width'), height = grab('height');
	if (!(durationSec > 0) || !(width > 0) || !(height > 0)) return null;
	return { fps: { num: 30, den: 1 }, durationFrames: Math.max(1, Math.round(durationSec * 30)), width: Math.round(width), height: Math.round(height) };
}

export function listTemplates() {
	if (!fs.existsSync(TEMPLATES_DIR)) return [];
	const out = [];
	for (const id of fs.readdirSync(TEMPLATES_DIR)) {
		const dir = templateDir(id);
		if (!dir) continue;
		let meta = {};
		try { meta = JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')); } catch { }
		let render = null;
		try { render = parseRenderFromHtml(fs.readFileSync(path.join(dir, 'index.html'), 'utf8')); } catch { }
		out.push({
			id,
			title: meta.title || id,
			summary: meta.summary || '',
			category: meta.category || '',
			tags: meta.tags || [],
			bestFor: meta.bestFor || [],
			aspect: meta.aspect || '16:9',
			durationSec: render ? +(render.durationFrames / render.fps.num).toFixed(2) : (meta.durationSec || null),
			render
		});
	}
	return out.sort((a, b) => a.id.localeCompare(b.id));
}

/** Copy a template into a fresh revision sources map. Returns {sources, entryFile, render, title}. */
export function templateSources(id) {
	const dir = templateDir(id);
	if (!dir) throw Object.assign(new Error('未知模板: ' + id), { code: 'E_TEMPLATE', status: 404 });
	const meta = (() => { try { return JSON.parse(fs.readFileSync(path.join(dir, 'template.json'), 'utf8')); } catch { return {}; } })();
	const html = fs.readFileSync(path.join(dir, 'index.html'), 'utf8');
	// 渲染参数优先级：HTML 根元素标记 > template.json（fps/durationSec，16:9 默认 1920x1080）> 8s 默认。
	let render = parseRenderFromHtml(html);
	if (!render) {
		const durationSec = Number(meta.durationSec) > 0 ? Number(meta.durationSec) : 8;
		render = { fps: { num: 30, den: 1 }, durationFrames: Math.max(1, Math.round(durationSec * 30)), width: 1920, height: 1080 };
	}
	const sources = {};
	const walk = (rel) => {
		const abs = path.join(dir, rel);
		for (const name of fs.readdirSync(abs)) {
			const r2 = rel ? rel + '/' + name : name;
			const p = path.join(dir, r2);
			const st = fs.statSync(p);
			if (st.isDirectory()) {
				// compositions/ 已在 vendor 时内联进 index.html，跳过副本
				if (r2 === 'compositions') continue;
				walk(r2);
			} else if (name !== 'template.json') {
				sources[r2] = fs.readFileSync(p);
			}
		}
	};
	walk('');
	if (!sources['index.html']) throw Object.assign(new Error('模板缺少 index.html: ' + id), { code: 'E_TEMPLATE', status: 500 });
	// 解包 <template id="*-template">：hyperframes 组合文件用 template 包裹 DOM 等引擎克隆，
	// 我们已静态内联，直接展开为活节点（否则时间线 tween 挂在惰性节点上，渲染全黑）。
	if (Buffer.isBuffer(sources['index.html'])) {
		let html = sources['index.html'].toString('utf8');
		// Inlined child files carry local zero-based clocks. Preserve the parent
		// composition's authored slots instead of starting every scene at zero.
		for(const slot of meta.sceneSlots||[]){
			if(!/^[\w-]+$/.test(slot.id)||!Number.isFinite(slot.start)||!Number.isFinite(slot.duration))throw new Error('Invalid template scene slot');
			const pattern=new RegExp('(<div\\b[^>]*data-composition-id="'+slot.id+'"[^>]*)(>)','i');
			html=html.replace(pattern,(_match,attrs,end)=>attrs.replace(/data-start="[^"]*"/,'data-start="'+slot.start+'"').replace(/data-duration="[^"]*"/,'data-duration="'+slot.duration+'"')+end);
		}
		html = html.replace(/<template\b[^>]*>([\s\S]*?)<\/template>/gi, '$1');
		sources['index.html'] = Buffer.from(html, 'utf8');
	}
	return { sources, entryFile: 'index.html', render, title: meta.title || id };
}
