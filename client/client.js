/**
 * DesignCraft for DSH — client entry.
 * Loaded by the DSH ModuleLoader; dynamically imports the editor modules served
 * by our own host routes, wires store/sync/actions/controller, and mounts the
 * editor into the DSH main slot. Editor errors are scoped and surfaced as visible failures; native computation is supervised.
 */
window.__ModuleLoader__.load({
	id: 'designcraft',
	factory(require) {
		const React = require('react');
		const h = React.createElement;
		const PKG_ID = 'designcraft';

		const DICT = {
			zh: { nav: 'Urania' },
			en: { nav: 'Urania' }
		};

		function initialState() {
			return {
				root: null, sessionCwd: null, services: {},uiBuild:169,workspaceMode:'native',
				docs: null, assets: [], tasks: [], templates: [], designSystems: [],
				activeId: null, doc: null, revision: null,
				dirty: false, saving: false, saveError: null, stateError: null,
				pendingRemote: null, sseStatus: 'offline',
				undoStack: [], redoStack: [], clipboard: null, wandMask: null,
				paintRev: 0, toast: null,
				ui: {
					tool: 'select', shapePreset: 'rect', fillStyle: '#287D6C', gradientEnd: '#FFFFFF',
					brushSize: 18, brushOpacity: 1, wandTolerance: 32,
					zoom: 1, panX: 0, panY: 0, pageId: null, selectedId: null,selectedIds:[],nativeSelection:null,nativeWholeId:null,nativeDraft:null,nativeTextEditor:null,pointer: null,
					marquee: null, draftShape: null, penPreview: null, gradientDrag: null, cropRect: null,
						editingTextId: null, drawer: null, presentation: false,chatOpen:true,inspectorOpen:false,chatFocus:0
				}
			};
		}

		function createStore(initial) {
			let state = initial;
			const listeners = new Set();
			return {
				get: () => state,
				set(patch) {
					if (!patch || typeof patch !== 'object' || Object.keys(patch).every(key => Object.is(state[key],patch[key]))) return;
					state = { ...state, ...patch };
					listeners.forEach(fn => fn());
				},
				subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
			};
		}

		function apply(ctx) {
			const store = createStore(initialState());
			let disposed = false;
            ctx.effect(() => () => {
                disposed = true;
                try { sync?.dispose(); } catch {}
                try { actions?.dispose(); } catch {}
                if (toastTimer) clearTimeout(toastTimer);
                if (window.__DESIGNCRAFT_DEV__?.store === store) delete window.__DESIGNCRAFT_DEV__;
            }, 'designcraft: client lifetime');
			let sync = null;
			let actions = null;
			let controller = null;
			let toastTimer = null;

			function toast(message) {
				store.set({ toast: String(message || '') });
				if (toastTimer) clearTimeout(toastTimer);
				toastTimer = setTimeout(() => store.set({ toast: null }), 2600);
			}

			ctx.effect(() => ctx.locale.register(PKG_ID, DICT), 'designcraft: dictionaries');
			ctx.effect(() => {
				const tag = document.createElement('style');
				tag.dataset.pluginCss = PKG_ID + '/entry.css';
				tag.textContent = '.dcPanelMount{height:100%;min-height:0}';
				document.head.appendChild(tag);
				return () => { try { tag.remove(); } catch { } };
			}, 'designcraft: entry styles');

					ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
						name: 'sidebar.panellist', id: 'designcraft', order: 6, locale: PKG_ID,label:()=>ctx.locale.bind(PKG_ID)('nav')
					}, () => h('svg', { width: 17, height: 17, viewBox: '0 0 28 28', fill: 'none', 'aria-hidden': true },
						h('rect', { x: 2.5, y: 2.5, width: 23, height: 23, rx: 6, stroke: 'currentColor', 'stroke-width': 1.8 }),
						h('circle', { cx: 10.2, cy: 10.2, r: 2.6, stroke: 'currentColor', 'stroke-width': 1.7 }),
						h('path', { d: 'M4.5 20.5 12 13.4l4.2 4 3.4-3.2 3.4 3.3', stroke: 'currentColor', 'stroke-width': 1.8, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }))));

			(async () => {
				try {
					const V = '?v=169';
					const base = (p) => new URL(p.replace(/^\/+/, ''), document.baseURI).pathname;
					const healthResponse=await fetch(base('/designcraft/api/v1/health'),{cache:'no-store'}),health=await healthResponse.json();
					if(!healthResponse.ok||health.protocolVersion!==2||health.uiBuild!==169||health.capabilities?.professionalEditor!==1||!health.capabilities.editorExecutionAdmission||!health.capabilities.nativeLiveness||!health.capabilities.nativeFileActions){
						let disk='';try{const response=await fetch(base('/designcraft/api/v1/versions'),{cache:'no-store'});if(response.ok){const d=(await response.json()).disk;disk='，磁盘 '+d.version+' / UI'+d.uiBuild;}}catch{}
						throw new Error('当前界面 UI'+store.get().uiBuild+'，后台 '+(health.version||'未知')+' / UI'+(health.uiBuild??'未知')+disk+'。组件版本或运行保护不匹配，请在方便时重新打开 DSH 以继续使用已保存作品。');
					}
					const [syncMod, toolsMod, deckMod, actionsMod, uiMod] = await Promise.all([
						import(base('/designcraft/api/v1/client/sync.js') + V),
						import(base('/designcraft/api/v1/client/tools.js') + V),
						import(base('/designcraft/api/v1/client/deck.js') + V),
						import(base('/designcraft/api/v1/client/actions.js') + V),
						import(base('/designcraft/api/v1/client/ui.js') + V)
					]);
					if (disposed) return;
					sync = syncMod.createSync(store);

					actions = actionsMod.createActions({ store, sync, toast });

					controller = toolsMod.createToolController({ store, sync, actions });
					// Test-only automation handle; never enabled by normal production entry.
					try { if(window.__DESIGNCRAFT_TEST__===true)window.__DESIGNCRAFT_DEV__ = { store, sync, actions, syncVersion: syncMod.SYNC_VERSION, setRoot: (p) => sync.setRoot(p) }; } catch { }

					// services: session cwd → default root; directory picker; workspaces
					ctx.inject(['sessions'], (scope) => {
						store.set({services:{...(store.get().services||{}),sessions:scope.sessions}});
						const update = () => {
							try {
								const list = scope.sessions.list.getSnapshot();
								const active = Object.values(list.byId || {}).find((row) => (row.retainedBy?.mainView || 0) > 0);
								const cwd = active?.cwd || null;
								if (cwd && cwd !== store.get().sessionCwd) store.set({ sessionCwd: cwd });
							} catch { }
						};
						scope.effect(() => scope.sessions.list.subscribe(update), 'designcraft: session catalog');
						update();
					});
					ctx.inject(['uiWorkspace'], (scope) => {
						store.set({ services: { ...(store.get().services || {}), uiWorkspace: scope.uiWorkspace } });
					});

                    ctx.inject(['uiSession'], scope=>{store.set({services:{...(store.get().services||{}),uiSession:scope.uiSession}});});
                    ctx.inject(['conversation'],scope=>{store.set({services:{...(store.get().services||{}),conversation:scope.conversation}});});
                    ctx.inject(['uiConversation'],scope=>{scope.effect(()=>scope.uiConversation.userText.register(uiMod.designContextTextRule),'designcraft: readable canvas references');});
                    ctx.inject(['inputTriggers'],scope=>{
                        scope.effect(()=>scope.inputTriggers.registerSource(uiMod.createDesignReferenceSource({store,sync,openDesign:()=>ctx.get('layout')?.selectPanel('designcraft'),onError:error=>toast(error.message)})),'designcraft: native reference serialization');
                    });

                    const {DesignAssistantSession}=await import(base('/designcraft/api/v1/client/design-session.js')+V);
                    const designAssistant=new DesignAssistantSession({getServices:()=>store.get().services,onChange:state=>store.set({designAssistant:state})});
                    store.set({services:{...store.get().services,designAssistant}});
                    ctx.effect(()=>()=>designAssistant.dispose(),'designcraft: dedicated design conversation');
					const { App,DesignConversation,nativeController } = uiMod.createUI({ React, store, sync, actions, controller });
                    store.set({nativeController});
                    ctx.effect(()=>()=>nativeController.dispose().catch(error=>toast(error.message)),'designcraft: native workspace lifetime');
                    ctx.inject(['uiConversation'],scope=>{scope.effect(()=>scope.uiConversation.userText.register(uiMod.nativeContextTextRule),'designcraft: native reference labels');});
                    ctx.inject(['inputTriggers'],scope=>{scope.effect(()=>scope.inputTriggers.registerSource(uiMod.createNativeReferenceSource({controller:nativeController,store})),'designcraft: native reference serialization');});
                    ctx.inject(['uiConversation'],scope=>{scope.effect(()=>scope.uiConversation.userText.register(uiMod.designRequestTextRule),'designcraft: compact request labels');});
                    ctx.inject(['inputTriggers'],scope=>{scope.effect(()=>scope.inputTriggers.registerSource(uiMod.createDesignRequestReferenceSource({store})),'designcraft: durable request serialization');});

					class EditorBoundary extends React.Component {
                        constructor(props) { super(props); this.state={error:null}; }
                        static getDerivedStateFromError(error) { return {error}; }
                        componentDidCatch(error) { console.warn('[designcraft] editor render failed:',String(error)); }
                        render() {
                            if(this.state.error)return h('div',{className:'dcPanelMount',style:{padding:20}},
                                h('p',null,'编辑区发生错误，已保存版本不会被自动覆盖。'),
                                h('p',null,String(this.state.error?.message||this.state.error)),
                                h('button',{onClick:()=>this.setState({error:null})},'重新加载编辑区'));
                            return this.props.children;
                        }
                    }
                    let chatRegistered=false;
                    function EditorPanel(props) {
                        const slot=props?.renderFactorySlot,Provider=props?.SessionProvider;
                        const renderConversation=React.useMemo(()=>chatRegistered&&slot&&Provider
                          ?reference=>h(Provider,{session:reference},slot('designcraft.conversation',{})):undefined,[slot,Provider,chatRegistered]);
                        return h(EditorBoundary,null,h('div',{className:'dcPanelMount'},h(App,{renderConversation})));
                    }

					// slots
					ctx.slots.inject('main', () => {
						const disposeChat=ctx.slots.registerFactory?.({name:'designcraft.conversation',scope:'session-maybe'},DesignConversation);
                        chatRegistered=!!disposeChat;
						const dispose = ctx.slots.register({ name: 'main', key: 'designcraft', locale: PKG_ID,children:{'designcraft.session':{kind:'single',scope:'session'}} }, EditorPanel);
						return () => {
							const layout = ctx.get('layout');
							if (layout?.panelInfo?.getSnapshot?.().activePanelId === 'designcraft') layout.selectPanel(null);
							if (typeof dispose === 'function') dispose();
                            disposeChat?.();chatRegistered=false;
						};
					});


				} catch (error) {
					console.warn('[designcraft] client init failed:', String(error));
					ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: 'designcraft', locale: PKG_ID }, () =>
						h('div', { style: { padding: 24, color: '#B44846' } }, 'Urania 加载失败：' + String(error))));
				}
			})();
		}

		return { inject: ['slots', 'locale'], apply };
	}
});
