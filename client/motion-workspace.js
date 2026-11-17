/**
 * Motion workspace v3 — conversation-first, inspired by open-design's player.
 * Layout: chat dock (left, shared design conversation) + pure stage (right).
 * The stage is for watching: click it to play/pause (handled by the frame
 * runtime); one export button renders AND downloads the MP4. No right-panel
 * manual, no frame jargon — seconds, not frames.
 */
export function createMotionWorkspace({ h, store, actions, React }) {

	function MotionWorkspace() {
		const { useState: useStateFn, useEffect: useEffectFn, useRef: useRefFn } = React;
		const [, force] = useStateFn(0);
		useEffectFn(() => store.subscribe(() => force((n) => n + 1)), []);
		const s = store.get();
		const m = s.motion || null;
		const [list, setList] = useStateFn(null);
		const [error, setError] = useStateFn(null);
		const enteringRef = useRefFn(false);
		const frameRef = useRefFn(null);
		const scopeKey=actions.motionScopeKey();
		useEffectFn(()=>m?.preview&&frameRef.current?actions.bindMotionPreview(frameRef.current):undefined,[m?.preview?.nonce]);

		// 进入即工作台：自动打开最近项目（没有就现场创建），失败才露出手动入口。
		useEffectFn(() => {
			if(!scopeKey)return;
			let alive = true;
			actions.listMotionProjects?.().then((p) => alive && setList(p)).catch(() => { });
			actions.listMotionTemplates?.().catch(() => { });
			if (enteringRef.current!==scopeKey) {
				enteringRef.current = scopeKey;
				actions.motionAutoEnter?.()
					.then(() => actions.listMotionProjects?.().then((p) => alive && setList(p)).catch(() => { }))
					.catch((e) => alive && setError(String(e.message || e)));
			}
			const timer = setInterval(() => { actions.motionPollHead?.().catch(() => { }); }, 1500);
			return () => { alive = false; clearInterval(timer);actions.closeMotionWorkspace(); };
		}, [scopeKey]);

		const quietSelect = { background: 'transparent', border: '1px solid var(--dc-line, #DEE3E9)', borderRadius: 6, fontSize: 12, color: 'var(--dc-muted, #74808C)', maxWidth: 150, padding: '3px 6px' };

		const projectBar = (list && list.length > 0) ? h('select', {
			style: quietSelect, value: m?.projectId || '', title: '打开其他动画项目',
			onChange: (e) => { if (e.target.value) actions.openMotionProject(e.target.value).catch((er) => setError(String(er.message || er))); }
		}, list.map((p) => h('option', { key: p.projectId, value: p.projectId }, p.title || p.projectId))) : null;
		const templates = s.motionTemplates || [];
		const templateBar = h('select', {
			style: quietSelect, value: '', title: '从模板新建动画项目',
			onChange: (e) => {
				const id = e.target.value; e.target.value = '';
				if (id) actions.createMotionFromTemplate(id).catch((er) => setError(String(er.message || er)));
			}
		}, [h('option', { key: 'x', value: '' }, '模板…')].concat(templates.map((t) => h('option', { key: t.id, value: t.id, title: t.summary }, (t.title || t.id) + (t.durationSec ? ' · ' + t.durationSec + 's' : '')))));

		if (!m?.projectId||!scopeKey||m.scope?.sessionId!==s.services.designAssistant?.scope()?.sessionId) {
			return h('div', { className: 'dc-motion-empty dcPanelMount', style: { display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 14, color: 'var(--dc-muted, #74808C)' } },
				h('div', { style: { fontSize: 16, fontWeight: 600 } }, '正在准备动画工作台…'),
				error ? h('div', { style: { color: '#B44846', fontSize: 12 } }, String(error)) : null,
				error && (list && list.length > 0) ? h('div', { style: { display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 200, overflow: 'auto', minWidth: 320 } },
					list.map((p) => h('button', { key: p.projectId, className: 'dcBtn', onClick: () => actions.openMotionProject(p.projectId).catch((er) => setError(String(er.message || er))) },
						'打开: ' + (p.title || p.projectId)))) : null,
				error ? h('button', { className: 'dcBtn dcPrimary', onClick: () => { enteringRef.current = true; actions.createMotionProject().catch((er) => setError(String(er.message || er))); } }, '+ 新建动画') : null);
		}

		const total = m.durationFrames || 120;
		const fps = (m.fps && m.fps.num) || 30;
		const rs = m.renderStatus || null;
		const rendering = ['starting','running','rendering','verifying','cleaning','cancelling'].includes(rs?.status);
		const curSec = ((m.currentFrame || 0) / fps).toFixed(1);
		const totalSec = (total / fps).toFixed(1);
		return h('div', { className: 'dc-motion dcPanelMount', style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
			h('div', { style: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderBottom: '1px solid var(--dc-line, #DEE3E9)', flex: 'none' } },
				h('button', { className: 'dcBtn', onClick: () => store.set({ workspaceMode: 'native' }) }, '← 设计'),
				h('span', { style: { fontWeight: 600, color: 'var(--dc-accent, #287D6C)' } }, '⚡ ' + (m.title || '动画')),
				projectBar,
				templateBar,
				h('button', { className: 'dcBtn', title: '新建空白动画项目', onClick: () => actions.createMotionProject().catch((er) => setError(String(er.message || er))) }, '+ 新建'),
				h('div', { style: { flex: 1 } }),
				h('button',{className:'dcBtn',onClick:()=>{setError(null);actions.motionDoctor().catch(er=>setError(String(er.message||er)));}},'检查导出环境'),
				h('button', { className: 'dcBtn', title: '导出可编辑的 .dcmotion 工程', onClick: () => actions.exportMotionProject() }, '⬇ 工程'),
				rendering&&rs?.jobId?h('button',{className:'dcBtn',disabled:rs.status==='cancelling',onClick:()=>actions.cancelMotionRender().catch(er=>setError(String(er.message||er)))},rs.status==='cancelling'?'正在取消…':'取消导出'):null,
				h('button', { className: 'dcBtn dcPrimary', disabled: rendering, onClick: () => actions.renderMotion().catch((er) => setError(String(er.message || er))) }, rendering ? ('渲染中 ' + (rs.progress || 0) + '%') : '▶ 导出 MP4')),
			error?h('div',{role:'alert',style:{padding:'8px 12px',color:'#a43d36'}},error):null,
			s.motionEnvironment?h('div',{role:'status',style:{padding:'8px 12px'}},s.motionEnvironment.available?'导出环境已就绪':s.motionEnvironment.error+'。'+s.motionEnvironment.recovery):null,
			h('div', { style: { flex: 1, position: 'relative', background: '#000', minHeight: 0 } },
				m.preview?h('iframe', {
					ref:frameRef,id: 'motion-preview', key: m.preview.nonce, src: actions.motionPreviewUrl(m),
					onLoad: () => actions.motionPreviewAutoplay(),
					style: { width: '100%', height: '100%', border: 0 }, sandbox: 'allow-scripts allow-same-origin',referrerPolicy:'no-referrer',allow:'autoplay'
				}):h('div',{role:'status',style:{padding:24,color:'#e4e8ec'}},m.previewError||'正在准备独立预览…'),
				m.previewError?h('div',{role:'alert',style:{position:'absolute',left:12,top:12,padding:10,color:'#fff',background:'#8c3c39'}},m.previewError):null,
				rs?.status === 'failed' ? h('div', { style: { position: 'absolute', left: 12, bottom: 44, padding: '6px 10px', borderRadius: 6, background: 'rgba(180,72,70,.92)', color: '#fff', fontSize: 12, maxWidth: '70%' } }, String(rs.error || '渲染失败')) : null),
			h('div', { style: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px', borderTop: '1px solid var(--dc-line)', flex: 'none' } },
				h('button', { className: 'dcBtn dcIcon', title: '播放 / 暂停（也可直接点击画面）', onClick: () => actions.toggleMotionPlay() }, m.playing ? '⏸' : '▶'),
				h('input', { type: 'range', min: 0, max: total - 1, value: m.currentFrame || 0, style: { flex: 1, accentColor: 'var(--dc-accent)' }, onChange: (e) => actions.seekMotionFrame(parseInt(e.target.value)) }),
				h('span', { style: { fontSize: 11, fontFamily: 'monospace', color: 'var(--dc-muted)', whiteSpace: 'nowrap' } }, curSec + 's / ' + totalSec + 's')));
	}

	return { MotionWorkspace };
}
