import {createVariantPanel} from './variant-ui.js';
import {createImagePanel} from './image-ui.js';
import {createNativeWorkspace} from './native-workspace.js?v=166';
import {quoteNative,nativeInputAdmissionLocked} from './native-reference.js?v=166';
import {aiCanvasTarget} from './ai-canvas.js?v=166';
import {isActiveDesignSession} from './design-session.js?v=166';
import {createChatSplit} from './chat-split.js?v=166';
import {submitNativePrompt,currentNativeInput} from './native-ai-input.js?v=166';
import {selectedObjectIds} from './native-contract.js?v=166';
import {createMotionWorkspace} from './motion-workspace.js?v=166';
import {createStudioComponents,mountStudioStyles,userFacingError} from './studio-system.js?v=166';
export {nativeReferenceSource as createNativeReferenceSource,nativeContextTextRule,designRequestReferenceSource as createDesignRequestReferenceSource,designRequestTextRule} from './native-reference.js?v=166';
import {selectedNative,nativeNodes,selectedIds} from './selection.js';
import {designChatContext,isDesignRootInSession,attachDesignReference,openNativeChatReference} from './dsh-context.js?v=166';
export {designContextTextRule,createDesignReferenceSource} from './dsh-context.js?v=166';
/**
 * DesignCraft editor UI — full WYSIWYG editor (React via DSH ModuleLoader).
 * Exports createUI({ React, store, sync, actions, controller }) → { App }.
 */
import { normalizeDoc, normalizeLayer, genId, renderPage, renderPageToCanvas, hitTest, invalidateLayerCache, api } from './engine.js';
import { parseSvgClient } from './svgtools.js';
import { LAYOUT_GALLERY, openPresentation, renderThumbnails } from './deck.js';

const BLEND_MODES = ['normal', 'multiply', 'screen', 'overlay', 'darken', 'lighten', 'color-dodge', 'color-burn', 'hard-light', 'soft-light', 'difference', 'exclusion', 'hue', 'saturation', 'color', 'luminosity'];
const SHAPE_PRESETS = ['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'pentagon', 'hexagon', 'star5', 'star4', 'star6', 'star8', 'arrowRight', 'arrowLeft', 'arrowUp', 'arrowDown', 'chevron', 'plus', 'line'];
const CANVAS_PRESETS = [
	{ name: '演示 16:9', width: 1280, height: 720, type: 'deck' },
	{ name: '海报 A4 竖', width: 794, height: 1123, type: 'canvas' },
	{ name: '社交方图', width: 1080, height: 1080, type: 'canvas' },
	{ name: '快拍 9:16', width: 720, height: 1280, type: 'canvas' },
	{ name: '横幅 Banner', width: 1500, height: 500, type: 'canvas' },
	{ name: '照片 3:2', width: 1500, height: 1000, type: 'photo' }
];

export function createUI({ React, store, sync, actions, controller, t }) {
	const h = (type,props,...children) => {
		let safeProps=props;
		if(props)for(const [key,handler] of Object.entries(props))if(/^on[A-Z]/.test(key)&&typeof handler==='function') {
			if(safeProps===props)safeProps={...props};
			safeProps[key]=(...args)=>{
				try {const result=handler(...args);if(result&&typeof result.catch==='function')result.catch(error=>actions.toast(error?.message||String(error)));return result;}
				catch(error){actions.toast(error?.message||String(error));}
			};
		}
		return React.createElement(type,safeProps,...children);
	};
  const {Workspace:NativeWorkspace,controller:nativeController}=createNativeWorkspace({React,store});
  const {MotionWorkspace}=createMotionWorkspace({h,store,actions,React});
  const ChatSplit=createChatSplit(React);
  const {Icon:StudioIcon,Button:StudioButton,Status:StudioStatus}=createStudioComponents(React);
  mountStudioStyles();
  const ImagePanel=createImagePanel({React,store,sync,actions});const VariantPanel=createVariantPanel({React,store,sync});
	const { useState, useEffect, useRef, useCallback, useMemo } = React;
	function useStore() {
		return React.useSyncExternalStore(store.subscribe, store.get, store.get);
	}

	/* ---------------- styles ---------------- */

	const CSS = `
.dcApp{--dc-accent:#287D6C;--dc-accent2:#8CCFBC;--dc-ink:var(--dsw-alias-label-primary,#202936);--dc-muted:var(--dsw-alias-label-tertiary,#74808C);--dc-bg:var(--dsw-alias-bg-base,#F5F6F8);--dc-surface:var(--dsw-alias-bg-base,#FFFFFF);--dc-soft:var(--dsw-alias-interactive-bg-hover,#EEF0F4);--dc-line:var(--dsw-alias-border-l2,#DEE3E9);--dc-danger:#B44846;
display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dc-bg);color:var(--dc-ink);font:13px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif;box-sizing:border-box}
.dcApp *,.dcApp *::before,.dcApp *::after{box-sizing:border-box}
body[data-ds-dark-theme] .dcApp{--dc-ink:#ECF0F5;--dc-muted:#A0AAB9;--dc-bg:#16191F;--dc-surface:#1D2129;--dc-soft:#262C36;--dc-line:#343C48}
.dcTop{display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);flex:none;-webkit-app-region:no-drag}
.dcBrand{display:flex;align-items:center;gap:8px;font-weight:700;letter-spacing:.02em;color:var(--dc-accent);margin-right:6px;white-space:nowrap}
.dcBtn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 10px;border:1px solid var(--dc-line);border-radius:7px;background:var(--dc-surface);color:var(--dc-ink);font:12px "Segoe UI","Microsoft YaHei UI",sans-serif;cursor:pointer;white-space:nowrap;transition:background .12s,border-color .12s}
.dcBtn:hover{background:var(--dc-soft);border-color:var(--dc-accent2)}
.dcBtn:active{transform:translateY(1px)}
.dcBtn:disabled{opacity:.45;cursor:default;transform:none}
.dcBtn.dcPrimary{background:var(--dc-accent);border-color:var(--dc-accent);color:#fff;font-weight:600}
.dcBtn.dcPrimary:hover{filter:brightness(.94);background:var(--dc-accent)}
.dcBtn.dcIcon{width:30px;padding:0}
.dcBtn.dcActive{border-color:var(--dc-accent);color:var(--dc-accent);background:color-mix(in srgb,var(--dc-accent) 8%,transparent)}
.dcSelect{height:30px;max-width:230px;border:1px solid var(--dc-line);border-radius:7px;background:var(--dc-surface);color:var(--dc-ink);font:12px "Segoe UI","Microsoft YaHei UI",sans-serif;padding:0 6px}
.dcInput{height:28px;border:1px solid var(--dc-line);border-radius:6px;background:var(--dc-surface);color:var(--dc-ink);font:12px "Segoe UI","Microsoft YaHei UI",sans-serif;padding:0 8px;width:100%}
.dcInput:focus,.dcSelect:focus,.dcTextarea:focus{outline:2px solid var(--dc-accent2);outline-offset:1px}
.dcTextarea{width:100%;min-height:64px;border:1px solid var(--dc-line);border-radius:6px;background:var(--dc-surface);color:var(--dc-ink);font:12px/1.6 "Segoe UI","Microsoft YaHei UI",sans-serif;padding:6px 8px;resize:vertical}
.dcStatusDot{width:8px;height:8px;border-radius:50%;flex:none}
.dcBody{flex:1;display:flex;min-height:0}
.dcRail{width:46px;flex:none;display:flex;flex-direction:column;align-items:center;gap:4px;padding:8px 0;background:var(--dc-surface);border-right:1px solid var(--dc-line);overflow:auto}
.dcToolBtn{width:34px;height:34px;display:flex;align-items:center;justify-content:center;border:1px solid transparent;border-radius:8px;background:none;color:var(--dc-muted);cursor:pointer}
.dcToolBtn:hover{background:var(--dc-soft);color:var(--dc-ink)}
.dcToolBtn.dcActive{background:color-mix(in srgb,var(--dc-accent) 12%,transparent);color:var(--dc-accent);border-color:var(--dc-accent2)}
.dcCenter{flex:1;display:flex;flex-direction:column;min-width:0}
.dcPageRail{display:flex;gap:6px;padding:8px 10px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);overflow-x:auto;flex:none;min-height:74px}
.dcThumb{flex:none;width:104px;border:2px solid var(--dc-line);border-radius:6px;overflow:hidden;background:#fff;cursor:pointer;position:relative;padding:0}
.dcThumb img{display:block;width:100%}
.dcThumb.dcActive{border-color:var(--dc-accent)}
.dcThumbLabel{position:absolute;left:0;right:0;bottom:0;font-size:9px;padding:1px 4px;background:rgba(0,0,0,.45);color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dcCanvasWrap{flex:1;position:relative;overflow:hidden;background:repeating-conic-gradient(#e9ebef 0 25%,#f3f4f7 0 50%) 50%/24px 24px;min-height:0}
body[data-ds-dark-theme] .dcCanvasWrap{background:repeating-conic-gradient(#20242c 0 25%,#1a1e25 0 50%) 50%/24px 24px}
.dcCanvasStack{position:absolute;transform-origin:0 0}
.dcCanvasStack canvas{position:absolute;left:0;top:0;display:block}
.dcStatusBar{display:flex;align-items:center;gap:14px;padding:4px 12px;background:var(--dc-surface);border-top:1px solid var(--dc-line);font-size:11px;color:var(--dc-muted);flex:none}
.dcRight{width:294px;flex:none;display:flex;flex-direction:column;border-left:1px solid var(--dc-line);background:var(--dc-surface);min-height:0}
.dcPanelTabs{display:flex;border-bottom:1px solid var(--dc-line);flex:none}
.dcPanelTabs button{flex:1;height:34px;border:0;background:none;color:var(--dc-muted);font:12px "Segoe UI","Microsoft YaHei UI",sans-serif;cursor:pointer;border-bottom:2px solid transparent}
.dcPanelTabs button.dcActive{color:var(--dc-accent);border-bottom-color:var(--dc-accent)}
.dcPanelScroll{flex:1;overflow:auto;padding:12px;min-height:0}
.dcField{display:flex;align-items:center;gap:6px;margin-bottom:8px}
.dcField label{width:58px;flex:none;font-size:11px;color:var(--dc-muted)}
.dcField .dcInput,.dcField .dcSelect{flex:1;min-width:0}
.dcRow{display:flex;gap:6px;margin-bottom:8px}
.dcRow>*{flex:1;min-width:0}
.dcSectionTitle{font-size:11px;font-weight:700;color:var(--dc-muted);letter-spacing:.05em;margin:14px 0 8px}
.dcSectionTitle:first-child{margin-top:0}
.dcLayerItem{display:flex;align-items:center;gap:6px;padding:5px 6px;border-radius:6px;cursor:pointer;border:1px solid transparent;font-size:12px}
.dcLayerItem:hover{background:var(--dc-soft)}
.dcLayerItem.dcActive{background:color-mix(in srgb,var(--dc-accent) 10%,transparent);border-color:var(--dc-accent2)}
.dcLayerItem .dcLName{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dcLayerItem .dcLType{font-size:9px;color:var(--dc-muted);border:1px solid var(--dc-line);border-radius:4px;padding:0 4px;flex:none}
.dcLayerChildren{margin-left:14px;border-left:1px dashed var(--dc-line);padding-left:4px}
.dcDrawerMask{position:fixed;inset:0;background:rgba(12,16,22,.42);z-index:9000}
.dcDrawer{position:fixed;top:0;right:0;bottom:0;width:min(430px,92vw);background:var(--dc-surface);z-index:9001;box-shadow:-12px 0 40px rgba(0,0,0,.25);display:flex;flex-direction:column}
.dcDrawerHead{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;border-bottom:1px solid var(--dc-line);font-weight:600}
.dcDrawerBody{flex:1;overflow:auto;padding:14px 16px}
.dcCard{border:1px solid var(--dc-line);border-radius:10px;padding:12px;margin-bottom:10px;background:var(--dc-surface)}
.dcCard h4{margin:0 0 4px;font-size:13px}
.dcCard p{margin:0;font-size:11px;color:var(--dc-muted)}
.dcCard.dcClickable{cursor:pointer;transition:border-color .12s}
.dcCard.dcClickable:hover{border-color:var(--dc-accent)}
.dcAssetGrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:8px}
.dcAssetItem{border:1px solid var(--dc-line);border-radius:8px;overflow:hidden;cursor:pointer;background:var(--dc-soft);aspect-ratio:1;display:flex;align-items:center;justify-content:center;padding:0}
.dcAssetItem img{max-width:100%;max-height:100%;object-fit:contain}
.dcAssetItem:hover{border-color:var(--dc-accent)}
.dcToast{position:fixed;left:50%;bottom:34px;transform:translateX(-50%);background:rgba(28,32,40,.92);color:#fff;padding:8px 16px;border-radius:9px;font-size:12px;z-index:12000;max-width:70vw;box-shadow:0 6px 24px rgba(0,0,0,.35)}
.dcTextEditor{position:absolute;z-index:50;background:transparent;border:1px dashed var(--dc-accent);color:inherit;margin:0;padding:0;resize:none;overflow:hidden;white-space:pre}
.dcLanding{flex:1;display:flex;align-items:center;justify-content:center}
.dcLandingCard{text-align:center;max-width:460px;padding:40px}
.dcLandingCard h2{margin:0 0 8px;font-size:22px}
.dcLandingCard p{color:var(--dc-muted);font-size:13px;margin:0 0 22px}
.dcMenu{position:absolute;top:100%;right:0;min-width:170px;background:var(--dc-surface);border:1px solid var(--dc-line);border-radius:9px;box-shadow:0 10px 32px rgba(0,0,0,.18);z-index:8000;padding:5px;white-space:nowrap}
.dcMenu button{display:block;width:100%;text-align:left;border:0;background:none;padding:7px 10px;border-radius:6px;font:12px "Segoe UI","Microsoft YaHei UI",sans-serif;color:var(--dc-ink);cursor:pointer}
.dcMenu button:hover{background:var(--dc-soft)}
.dcColorSwatch{width:28px;height:28px;flex:none;border:1px solid var(--dc-line);border-radius:6px;padding:0;background:none;cursor:pointer}
.dcSlider{flex:1;accent-color:var(--dc-accent);min-width:0}
.dcHint{font-size:10px;color:var(--dc-muted);line-height:1.7}
.dcChat{width:360px;min-width:300px;max-width:min(48vw,580px);resize:horizontal;overflow:hidden;flex:none;display:flex;flex-direction:column;min-height:0;border-right:1px solid var(--dc-line);background:var(--dc-surface);--dsh-chat-content-width:calc(100% - 24px);--dsh-chat-user-width:calc(100% - 24px);--dsh-composer-card-max-width:100%;--dsh-conversation-column-width:360px}
.dcChatHead{display:flex;align-items:center;gap:8px;padding:13px 14px;border-bottom:1px solid var(--dc-line);flex:none}.dcChatHead strong{font-size:14px}.dcChatHead .dcHint{margin-left:auto}
.dcChatConversation{display:flex;flex-direction:column;flex:1;min-height:0;min-width:0}
.dcChat [data-conversation-region="composer"]{margin-top:auto}
.dcChatWelcome{padding:28px 16px 20px}.dcChatWelcome h3{font-size:20px;line-height:1.45;margin:0 0 10px}.dcChatWelcome p{color:var(--dc-muted);font-size:12px;margin:0 0 14px}
.dcChatReferences{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:8px}.dcChatReference{display:flex;align-items:center;gap:5px;border:1px solid var(--dc-accent2);border-radius:7px;background:color-mix(in srgb,var(--dc-accent) 6%,transparent);padding:4px 7px;font-size:11px;max-width:100%}.dcChatReference span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px}.dcChatReference button{border:0;background:none;color:var(--dc-muted);cursor:pointer;padding:0 2px}.dcChatError{padding:8px 10px;border-radius:6px;background:color-mix(in srgb,var(--dc-danger) 10%,transparent);color:var(--dc-danger);font-size:11px;margin-bottom:7px;overflow-wrap:anywhere}
.dcSelectionBar{position:absolute;bottom:12px;left:12px;z-index:60;display:flex;align-items:center;gap:6px;padding:5px 7px;background:var(--dc-surface);border:1px solid var(--dc-line);border-radius:9px;box-shadow:0 4px 14px rgba(0,0,0,.08);font-size:11px;max-width:calc(100% - 24px)}.dcSelectionBar>span{max-width:160px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dcWorkLabel{height:40px;display:flex;align-items:center;gap:10px;padding:0 14px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);font-size:12px;flex:none}.dcWorkLabel .dcHint{margin-left:auto}
@media(max-width:1150px){.dcTop{overflow-x:auto}.dcChat{width:310px;min-width:280px}.dcRight{width:264px}}
.dcKbd{font:10px Consolas,monospace;border:1px solid var(--dc-line);border-radius:4px;padding:0 4px;background:var(--dc-soft)}
.dcAdjustGrid{display:grid;grid-template-columns:1fr 1fr;gap:6px 10px}
.dcChip{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dc-line);border-radius:999px;padding:2px 9px;font-size:11px;cursor:pointer;background:var(--dc-surface);color:var(--dc-muted)}
.dcChip.dcActive{border-color:var(--dc-accent);color:var(--dc-accent)}
`;

	function injectStyles() {
		if (document.getElementById('designcraft-ui-styles')) return;
		const style = document.createElement('style');
		style.id = 'designcraft-ui-styles';
		style.textContent = CSS;
		document.head.appendChild(style);
	}

	/* ---------------- icons ---------------- */

	const ICONS = {
		select: 'M4 3l7 17 2.5-6.5L20 11 4 3z', hand: 'M8 12V6a1.5 1.5 0 0 1 3 0v5V4.5a1.5 1.5 0 0 1 3 0V11v-5a1.5 1.5 0 0 1 3 0v8.5a5.5 5.5 0 0 1-5.5 5.5h-1A5.5 5.5 0 0 1 5 14.5V10a1.5 1.5 0 0 1 3 0v2',
		text: 'M5 5h14M12 5v14M8 19h8', shape: 'M4 5h9v9H4zM13 13h7v7h-7z', pen: 'M12 19l7-7-4-4-7 7-1.5 5.5L12 19zM14 6l4 4',
		brush: 'M4 20s1-4 4-4 3 2 5 2 4-2 6-8c-4 2-6 1-8-1-1 3-7 3-7 11zM14 6l4-4 4 4-4 4',
		eraser: 'M4 16l8-8 6 6-4 4H7l-3-2zM10 20h10', fill: 'M6 13l6-6 6 6-6 6-6-6zM18 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z',
		gradient: 'M4 4h16v16H4zM4 14h16M4 17h16', dropper: 'M18 3a2.8 2.8 0 0 1 2 4.8L14 14l-3-3 6-6a2.8 2.8 0 0 1 1-2zM11 11l-6 6v3h3l6-6',
		marquee: 'M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4', wand: 'M6 18L18 6M15 3l1.5 2.5L19 7l-2.5 1.5L15 11l-1.5-2.5L11 7l2.5-1.5L15 3zM5 12l1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2',
		crop: 'M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14', zoom: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15 15l5 5',
		undo: 'M4 9h10a5 5 0 0 1 0 10h-3M4 9l4-4M4 9l4 4', redo: 'M20 9H10a5 5 0 0 0 0 10h3M20 9l-4-4M20 9l-4 4',
		plus: 'M12 5v14M5 12h14', play: 'M7 5v14l12-7L7 5z', download: 'M12 4v11m0 0 4-4m-4 4-4-4M4 19h16',
		folder: 'M3 7V5h6l2 2h10v12H3V7z', image: 'M4 5h16v14H4zM4 15l5-5 4 4 3-3 4 4M9 9.5a1 1 0 1 1-2 0 1 1 0 0 1 2 0',
		layers: 'm12 3 10 5-10 5L2 8l10-5zM2 16l10 5 10-5M2 12l10 5 10-5', ai: 'm12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2L12 3z',
		template: 'M4 4h16v6H4zM4 13h7v7H4zM14 13h6v7h-6z', palette: 'M12 3a9 9 0 1 0 0 18h1.5a2.5 2.5 0 0 0 0-5H12a2 2 0 0 1 0-4h5a4 4 0 0 0 4-4c0-3-4-5-9-5z',
		close: 'm6 6 12 12M18 6 6 18', settings: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.5-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.4 2.6a7 7 0 0 0-2 1.2l-2.5-1-2 3.5 2 1.5A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.5 2 3.5 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.4-2.6a7 7 0 0 0 2-1.2l2.5 1 2-3.5-2-1.5c.1-.4.1-.8.1-1.2z',
		eye: 'M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6zM12 12a2 2 0 1 0 0-.01', eyeOff: 'M4 4l16 16M9.9 5.2A10.6 10.6 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.6M6.6 6.6A16.4 16.4 0 0 0 2 12s3.5 7 10 7a10 10 0 0 0 4-.8M9.9 9.9a3 3 0 0 0 4.2 4.2',
		lock: 'M6 11h12v9H6zM9 11V8a3 3 0 0 1 6 0v3', trash: 'M4 6h16M9 6V4h6v2M6 6l1 14h10l1-14',
		copy: 'M8 8h12v12H8zM4 16V4h12', up: 'm6 14 6-6 6 6', down: 'm6 10 6 6 6-6', check: 'm5 12 4 4L19 6'
	};

	function Icon({ name, size = 16 }) {
		return h('svg', { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, h('path', { d: ICONS[name] || ICONS.shape }));
	}

	/* ---------------- shared small components ---------------- */

	function ColorField({ value, onChange, allowNone }) {
		const safe = typeof value === 'string' && value.startsWith('#') ? value.slice(0, 7) : '#287D6C';
		return h('div', { className: 'dcField' },
			h('label', null, '颜色'),
			h('input', { type: 'color', className: 'dcColorSwatch', value: safe, onChange: (e) => onChange(e.target.value) }),
			h('input', { className: 'dcInput', value: value ?? '', onChange: (e) => onChange(e.target.value), placeholder: allowNone ? '#hex / var(--color-x)' : '#hex 或 var(--color-x)' }),
			allowNone ? h('button', { className: 'dcBtn dcIcon', title: '无填充', onClick: () => onChange('none') }, '∅') : null
		);
	}

	function NumberField({ label, value, onChange, step = 1, min, max }) {
		return h('div', { className: 'dcField' },
			h('label', null, label),
			h('input', { type: 'number', className: 'dcInput', value: value ?? 0, step, min, max, onChange: (e) => onChange(parseFloat(e.target.value) || 0) }));
	}

	function Toast({ message }) {
		if (!message) return null;
		return h('div', { className: 'dcToast', role: 'status' }, message);
	}

	/* ---------------- top bar ---------------- */

	function TopBar() {
		const s = useStore();
		const [menuOpen, setMenuOpen] = useState(null); // 'doc' | 'new' | 'export'
		const doc = s.doc;
		const sseDot = { live: '#287E59', connecting: '#9E7129', offline: '#B44846' }[s.sseStatus || 'offline'];
		useEffect(() => {
			const close = () => setMenuOpen(null);
			window.addEventListener('click', close);
			return () => window.removeEventListener('click', close);
		}, []);
        const pendingPaint=layers=>(layers||[]).some(layer=>layer.pendingNativePaint?.strokes?.length||pendingPaint(layer.children));
        const pending=doc?.pages.some(page=>pendingPaint(page.layers)),saveLabel=s.conflict?'有编辑冲突':s.nativeBusy?'原生处理中':pending?'笔画待处理':s.saving?'保存中…':s.dirty?'待保存':'已保存';
		const menuBtn = (id, label, icon) => h('div', { style: { position: 'relative' } },
			h('button', { className: 'dcBtn', onClick: (e) => { e.stopPropagation(); setMenuOpen(menuOpen === id ? null : id); } }, icon ? h(Icon, { name: icon, size: 14 }) : null, label),
			menuOpen === id ? h('div', { className: 'dcMenu', onClick: (e) => e.stopPropagation() },
				id === 'doc' ? (s.docs || []).map(d => h('button', { key: d.id, onClick: () => { setMenuOpen(null); sync.openDoc(d.id).catch(error=>actions.toast(error.message)); } }, (d.id === s.activeId ? '● ' : '') + (d.title || d.id) + (d.type === 'deck' ? '（演示）' : d.type === 'photo' ? '（图片）' : ''))) : null,
				id === 'doc' && !(s.docs || []).length ? h('button', { disabled: true }, '暂无文档') : null,
				id === 'new' ? [
					h('button', { key: 'blank', onClick: () => { setMenuOpen(null); sync.createDoc(blankDoc('canvas')).catch((err) => actions.toast('新建失败：' + String(err?.message || err).slice(0, 120))); } }, '空白画板'),
					h('button',{key:'photo',onClick:()=>{setMenuOpen(null);return actions.createPhotoWork();}},'图片作品（可直接绘画）'),
                    h('button',{key:'vector',onClick:()=>{setMenuOpen(null);return actions.createVectorWork();}},'矢量画板'),
					h('button', { key: 'deck', onClick: () => { setMenuOpen(null); sync.createDoc(blankDoc('deck')).catch((err) => actions.toast('新建失败：' + String(err?.message || err).slice(0, 120))); } }, '空白演示文稿（16:9）'),
					h('button', { key: 'outline', onClick: () => { setMenuOpen(null); store.set({ ui: { ...store.get().ui, chatOpen:true,chatFocus:(store.get().ui.chatFocus||0)+1 } }); } }, '和 AI 制作演示…'),
					h('button',{key:'importdeck',onClick:()=>{setMenuOpen(null);const input=document.createElement('input');input.type='file';input.accept='.pptx,.deckcraft';input.onchange=async()=>{try{if(input.files?.length)await actions.importDeckFiles([...input.files]);}catch(error){actions.toast(error.message);}};input.click();}},'导入演示文稿…'),
                    h('button', { key: 'tpl', onClick: () => { setMenuOpen(null); store.set({ ui: { ...store.get().ui, drawer: 'templates' } }); } }, '从模板新建…')
				] : null,
				id === 'export' ? [
                    s.doc?.native?.deck?.exportSource?h('a',{key:'nativesource',className:'dcBtn',href:sync.assetUrl(s.doc.native.deck.exportSource),download:s.doc.native.deck.exportSource},'下载上次完整演示源'):null,
					h('button',{key:'png1',onClick:()=>{setMenuOpen(null);return actions.exportPagePng(1);}},'当前页 PNG（1×）'),
					h('button', { key: 'png', onClick: () => { setMenuOpen(null); return actions.exportPagePng(2); } }, '当前页 PNG（2×）'),
					h('button',{key:'whole-svg',onClick:()=>{setMenuOpen(null);return actions.exportWholePageSvg();}},'当前整页 SVG（可编辑矢量）'),
					h('button', { key: 'svg', onClick: () => { setMenuOpen(null); return actions.exportPageSvg(); } }, '选中对象 SVG 源'),
					h('button', { key: 'pptx', onClick: () => { setMenuOpen(null); return actions.exportPptx(); } }, 'PPTX（PowerPoint）'),
					h('button',{key:'nativepdf',onClick:()=>{setMenuOpen(null);return actions.exportNativePdf();}},'PDF（原生文字与矢量）'),
                ...['psd','png','jpg','webp','tiff'].map(format=>h('button',{key:'photo-'+format,onClick:()=>{setMenuOpen(null);return actions.exportPhoto(format);}},'选中图片源 '+format.toUpperCase())),
					h('button', { key: 'pdf', onClick: () => { setMenuOpen(null); return actions.exportPdf(); } }, 'PDF（高保真位图）'),
					h('button', { key: 'html', onClick: () => { setMenuOpen(null); return actions.exportHtml(); } }, 'HTML 预览（图像）'),
					h('button', { key: 'md', onClick: () => { setMenuOpen(null); return actions.exportMd(); } }, 'Markdown 大纲')
				] : null
			) : null
		);
		return h('div', { className: 'dcTop' },
			h('div', { className: 'dcBrand' }, h('svg', { width: 18, height: 18, viewBox: '0 0 28 28', fill: 'none' }, h('rect', { x: 2.5, y: 2.5, width: 23, height: 23, rx: 6, stroke: 'currentColor', 'stroke-width': 2 }), h('path', { d: 'M4.5 20.5 12 13.4l4.2 4 3.4-3.2 3.4 3.3', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linejoin': 'round' })), 'DesignCraft'),
			menuBtn('doc', doc ? (doc.title || doc.id) : '打开文档…', 'folder'),
			menuBtn('new', '新建', 'plus'),
			h('button', {className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,drawer:'assets'}})}, '素材'),
      h('button',{className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,drawer:'images'}})},'AI 图像'),
      h('button',{className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,drawer:'variants'}})},'方案'),
			h('button', {className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,drawer:'systems'}})}, '设计'),
			h('button', {className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,drawer:'layouts'}})}, '版式'),
			h('button', {className:'dcBtn',disabled:!doc,onClick:()=>store.set({ui:{...store.get().ui,drawer:'history'}})}, '版本'),
			h('button', {className:'dcBtn',onClick:()=>store.set({workspaceMode:'motion'})}, '⚡ 动画'),
      doc&&doc.native?.deck?.mode!=='source'?h('button',{className:'dcBtn',onClick:()=>actions.exportPptx('deck.promote')},'启用原生演示编辑'):null,
			h('button', { className: 'dcBtn dcIcon', title: '撤销 (Ctrl+Z)', disabled: !(s.undoStack || []).length, onClick: actions.undo }, h(Icon, { name: 'undo', size: 14 })),
			h('button', { className: 'dcBtn dcIcon', title: '重做 (Ctrl+Shift+Z)', disabled: !(s.redoStack || []).length, onClick: actions.redo }, h(Icon, { name: 'redo', size: 14 })),
			h('div', { style: { flex: 1 } }),
			h('span',{className:'dcHint',title:'保存状态：'+saveLabel},saveLabel),
			h('span', { title: '实时同步：' + s.sseStatus + '（版本化协作）', style: { display: 'inline-flex', alignItems: 'center', gap: 5 } }, h('span', { className: 'dcStatusDot', style: { background: sseDot } }), '协作同步'),
			h('button', { className: 'dcBtn'+(s.ui.chatOpen!==false?' dcActive':''), onClick: () => store.set({ ui: { ...store.get().ui, chatOpen:s.ui.chatOpen===false,chatFocus:(s.ui.chatFocus||0)+1 } }) }, h(Icon, { name: 'ai', size: 14 }), 'AI 对话'),
            h('button',{className:'dcBtn'+(s.ui.inspectorOpen?' dcActive':''),onClick:()=>store.set({ui:{...store.get().ui,inspectorOpen:!s.ui.inspectorOpen}})},'属性'),
			menuBtn('export', '导出', 'download'),
			h('button', { className: 'dcBtn dcPrimary', disabled: !doc, onClick: actions.startPresentation }, h(Icon, { name: 'play', size: 14 }), s.doc?.native?.deck?.mode==='source'?'静态预览':'演示')
		);
	}

	function blankDoc(type) {
		const size = type === 'deck' ? { width: 1280, height: 720 } : { width: 1080, height: 1080 };
		return normalizeDoc({
			title: type === 'deck' ? '新演示文稿' : '新画板', type,
			canvas: size,
			designSystem: { colors: { primary: '#287D6C', accent: '#9E7129', ink: '#202936', muted: '#74808C', bg: '#FFFFFF', surface: '#F5F6F8' } },
			pages: [{ id: genId('pg'), name: '页面 1', background: { kind: 'solid', color: '#FFFFFF' }, layers: [], notes: '', transition: { kind: 'fade', duration: 400 } }]
		});
	}

	/* ---------------- tool rail ---------------- */

	const TOOLS = [
		['select', '移动/选择 (V)', 'select'],
        ['direct','节点 (A) — 拖动矢量锚点与控制柄','pen'],
		['text', '文字 (T) — 点击画布创建，双击编辑', 'text'],
		['shape', '形状 (S) — 拖拽创建', 'shape'],
		['pen', '钢笔 (P) — 点击加点，Enter 闭合', 'pen'],
		['brush', '画笔 (B) — 作用于选中图片', 'brush'],
		['eraser', '橡皮擦 (E)', 'eraser'],
		['fill', '油漆桶 — 点击填充', 'fill'],
		['gradient', '渐变 — 在图层上拖拽', 'gradient'],
		['eyedropper', '吸管 — 取色', 'dropper'],
		['marqueeRect', '矩形选框 (M)', 'marquee'],
		['marqueeEllipse', '椭圆选框', 'marquee'],
		['lasso', '套索', 'marquee'],
		['magicwand', '魔棒 — 容差选区', 'wand'],
		['crop', '裁剪 — 拖拽后点应用', 'crop'],
		['hand', '抓手 (H) / 空格拖拽', 'hand']
	];

	function ToolRail() {
		const s = useStore();
		return h('div', { className: 'dcRail' },
			TOOLS.map(([tool, title, icon]) => h('button', { key: tool, className: 'dcToolBtn' + (s.ui.tool === tool ? ' dcActive' : ''), title, onClick: () => actions.setTool(tool) }, h(Icon, { name: icon, size: 17 }))),
			h('div', { style: { flex: 1 } }),
			h('button', { className: 'dcToolBtn', title: '缩小', onClick: () => actions.zoomBy(1 / 1.2) }, h('span', { style: { fontSize: 16 } }, '−')),
			h('button', { className: 'dcToolBtn', title: '放大', onClick: () => actions.zoomBy(1.2) }, h('span', { style: { fontSize: 14 } }, '＋'))
		);
	}

	/* ---------------- page rail ---------------- */

	function PageRail() {
		const s = useStore();
		const [thumbs, setThumbs] = useState({});
		const doc = s.doc;
		useEffect(() => {
			let alive = true;
			if (!doc) return;
			(async () => {
				try {
					const rendered = await renderThumbnails(doc, 100);
					if (alive) setThumbs(Object.fromEntries(rendered.map(r => [r.id, r.url])));
				} catch { }
			})();
			return () => { alive = false; };
		}, [doc, s.revision, s.paintRev]);
		if (!doc) return null;
		return h('div', { className: 'dcPageRail' },
			doc.pages.map((page, i) => h('button', { key: page.id, className: 'dcThumb' + (s.ui.pageId === page.id ? ' dcActive' : ''), onClick: () => actions.setPageId(page.id), title: page.name },
				thumbs[page.id] ? h('img', { src: thumbs[page.id], alt: '' }) : h('div', { style: { height: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#98a2ad', fontSize: 10 } }, '渲染中…'),
				h('span', { className: 'dcThumbLabel' }, (i + 1) + '. ' + (page.name || ''))),
				h('span', { style: { display: 'none' } })),
			h('button', { className: 'dcBtn dcIcon', style: { alignSelf: 'center', height: 52 }, title: '添加页面', onClick: () => actions.addPage() }, h(Icon, { name: 'plus' }))
		);
	}

	/* ---------------- canvas host ---------------- */

	function CanvasHost() {
		const s = useStore();
		const mainRef = useRef(null);
		const frameTicket=useRef(0),renderGate=useRef({busy:false,next:null});
		const overlayRef = useRef(null);
		const wrapRef = useRef(null);
		const doc = s.doc;
		const page = doc?.pages?.find(p => p.id === s.ui.pageId) || doc?.pages?.[0] || null;

		const renderAll = useCallback(async () => {
			if (!doc || !page || !mainRef.current) return;
			const ticket=++frameTicket.current,gate=renderGate.current;if(gate.busy){gate.next=renderAll;return;}gate.busy=true;try{
			const v = store.get().ui;
			const dpr = Math.min(2, window.devicePixelRatio || 1);
			const W = doc.canvas.width, H = doc.canvas.height;
      const main=mainRef.current;
      const pw=Math.max(1,Math.round(W*v.zoom)),ph=Math.max(1,Math.round(H*v.zoom));
      const backingScale=Math.min(v.zoom*dpr,16384/W,16384/H,Math.sqrt(24_000_000/(W*H)));
      const frame=document.createElement('canvas');frame.width=Math.max(1,Math.floor(W*backingScale));frame.height=Math.max(1,Math.floor(H*backingScale));
      await renderPage(frame.getContext('2d'),page,doc,{scale:backingScale});
      if(ticket!==frameTicket.current||main!==mainRef.current)return;
      main.width=frame.width;main.height=frame.height;main.style.width=pw+'px';main.style.height=ph+'px';
      main.getContext('2d').drawImage(frame,0,0);

			drawOverlay();if(store.get().renderError)store.set({renderError:null});
      }finally{gate.busy=false;const next=gate.next;gate.next=null;if(next)queueMicrotask(()=>next().catch(error=>{if(mainRef.current)store.set({renderError:error.message});}));}
		}, [s.ui.tool,doc, page, s.ui.zoom, s.ui.panX, s.ui.panY, s.paintRev, s.revision, s.ui.selectedId, s.ui.selectedIds, s.ui.nativeSelection, s.ui.nativeDraft, s.ui.marquee, s.ui.draftShape, s.ui.penPreview, s.ui.cropRect, s.ui.gradientDrag]);

		useEffect(() => { let alive = true; (async () => { try { if (alive) await renderAll(); } catch (e) { console.warn('[designcraft] render skipped:', String(e));if(alive)store.set({renderError:String(e?.message||e)}); } })(); return () => { alive = false;frameTicket.current++; }; }, [renderAll]);

		const drawOverlay = () => {
			const overlay = overlayRef.current;
			if (!overlay || !doc) return;
			const v = store.get().ui;
			const pw = Math.max(1,Math.round(doc.canvas.width*v.zoom)),ph=Math.max(1,Math.round(doc.canvas.height*v.zoom));
            const dpr=Math.min(2,window.devicePixelRatio||1,16384/pw,16384/ph,Math.sqrt(24_000_000/(pw*ph)));
			if (overlay.width !== Math.round(pw * dpr)||overlay.height!==Math.round(ph*dpr)) { overlay.width = Math.round(pw * dpr); overlay.height = Math.round(ph * dpr); }
			overlay.style.width = pw + 'px';
			overlay.style.height = ph + 'px';
			const ctx = overlay.getContext('2d');
			ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			ctx.clearRect(0, 0, pw, ph);
			const toS = (pt) => ({ x: pt.x * v.zoom, y: pt.y * v.zoom });
      if(v.tool==='direct'){
        for(const node of controller.vectorNodeHandles()){
          const point=toS(node);if(node.anchor){const anchor=toS(node.anchor);ctx.strokeStyle='#9E7129';ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(point.x,point.y);ctx.stroke();}
          ctx.fillStyle=node.type==='anchor'?'#287D6C':'#FFFFFF';ctx.strokeStyle='#287D6C';ctx.lineWidth=1.2;
          if(node.type==='anchor'){ctx.fillRect(point.x-3,point.y-3,6,6);ctx.strokeRect(point.x-3,point.y-3,6,6);}else{ctx.beginPath();ctx.arc(point.x,point.y,3.5,0,Math.PI*2);ctx.fill();ctx.stroke();}
        }
      }
			// selection box + handles
			const bounds = controller.selectionBounds?.();
			if (bounds) {
				const a = toS({ x: bounds.x, y: bounds.y });
				ctx.strokeStyle = '#287D6C';
				ctx.lineWidth = 1.4;
				ctx.setLineDash([]);
				ctx.strokeRect(a.x, a.y, bounds.w * v.zoom, bounds.h * v.zoom);
				for (const [, hx, hy] of (v.tool==='select'?controller.handlePositions(bounds):[])) {
					const p = toS({ x: hx, y: hy });
					ctx.fillStyle = '#fff';
					ctx.strokeStyle = '#287D6C';
					ctx.beginPath();
					ctx.rect(p.x - 4.5, p.y - 4.5, 9, 9);
					ctx.fill(); ctx.stroke();
				}
				if(v.tool==='select'){const top = toS({ x: bounds.x + bounds.w / 2, y: bounds.y });
				ctx.beginPath(); ctx.moveTo(top.x, top.y); ctx.lineTo(top.x, top.y - 22); ctx.stroke();
				ctx.beginPath(); ctx.arc(top.x, top.y - 26, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();}
			}
			// marquee
			const m = v.marquee;
			if (m) {
				ctx.strokeStyle = '#287D6C';
				ctx.setLineDash([5, 4]);
				if (m.mode === 'lasso' && m.points) {
					ctx.beginPath();
					m.points.forEach((p, i) => { const q = toS(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
					ctx.stroke();
				} else {
					const a = toS({ x: Math.min(m.start.x, m.current.x), y: Math.min(m.start.y, m.current.y) });
					const w = Math.abs(m.current.x - m.start.x) * v.zoom, h2 = Math.abs(m.current.y - m.start.y) * v.zoom;
					if (m.mode === 'marqueeEllipse') { ctx.beginPath(); ctx.ellipse(a.x + w / 2, a.y + h2 / 2, w / 2, h2 / 2, 0, 0, Math.PI * 2); ctx.stroke(); }
					else ctx.strokeRect(a.x, a.y, w, h2);
				}
				ctx.setLineDash([]);
			}
			// draft shape
			if (v.draftShape) {
				const a = toS({ x: v.draftShape.x, y: v.draftShape.y });
				ctx.strokeStyle = '#9E7129';
				ctx.setLineDash([4, 3]);
				ctx.strokeRect(a.x, a.y, v.draftShape.w * v.zoom, v.draftShape.h * v.zoom);
				ctx.setLineDash([]);
			}
			// pen preview
			if (v.penPreview && v.penPreview.length) {
				ctx.strokeStyle = '#287D6C';
				ctx.lineWidth = 1.6;
				ctx.beginPath();
				v.penPreview.forEach((p, i) => { const q = toS(p); i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); });
				ctx.stroke();
				for (const p of v.penPreview) {
					const q = toS(p);
					ctx.fillStyle = '#287D6C';
					ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
				}
			}
			// gradient drag line
			if (v.gradientDrag) {
				const a = toS(v.gradientDrag.start), b = toS(v.gradientDrag.current);
				ctx.strokeStyle = '#9E7129';
				ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
			}
			// crop overlay
			if (v.cropRect) {
				const a = toS({ x: v.cropRect.x, y: v.cropRect.y });
				ctx.fillStyle = 'rgba(0,0,0,.35)';
				ctx.fillRect(0, 0, pw, ph);
				ctx.clearRect(a.x, a.y, v.cropRect.w * v.zoom, v.cropRect.h * v.zoom);
				ctx.strokeStyle = '#fff';
				ctx.setLineDash([6, 4]);
				ctx.strokeRect(a.x, a.y, v.cropRect.w * v.zoom, v.cropRect.h * v.zoom);
				ctx.setLineDash([]);
			}
		};

		if (!doc || !page) return h('div', { className: 'dcCanvasWrap dcLanding' }, h('div', { className: 'dcHint' }, '选择或新建一个文档开始设计'));

		const editing = s.ui.editingTextId ? (function find(layers) { for (const l of layers || []) { if (l.id === s.ui.editingTextId) return l; if (l.type === 'group') { const r = find(l.children); if (r) return r; } } return null; })(page.layers) : null;

		return h('div', {
			className: 'dcCanvasWrap', ref: wrapRef,
			onDragOver: (e) => e.preventDefault(),
			onDrop: (e) => {
				e.preventDefault();
				const files = [...(e.dataTransfer?.files || [])];
				const pt = controller.toDoc({clientX:e.clientX,clientY:e.clientY,currentTarget:overlayRef.current});
				const svgs = files.filter(f => /\.svg$/i.test(f.name));
				const images = files.filter(f => !/\.svg$/i.test(f.name));
				if (svgs.length) actions.importSvgFiles(svgs, pt);
				if (images.length) actions.importFilesAsLayers(images, pt);
			}
		},
			h('div', {
				className: 'dcCanvasStack',
				style: { transform: `translate(${s.ui.panX}px, ${s.ui.panY}px)` }
			},
				h('canvas', { ref: mainRef }),
				h('canvas', {
					ref: overlayRef,
					style: { cursor: s.ui.tool === 'hand' ? 'grab' : 'default', touchAction: 'none' },
					onPointerDown: controller.onPointerDown,
					onPointerMove: controller.onPointerMove,
					onPointerUp: controller.onPointerUp,
					onPointerCancel: controller.onPointerCancel,
					onWheel: (e) => {
						e.preventDefault();
						const v = store.get().ui;
						if (e.ctrlKey || e.metaKey) {
							const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
							const rect = e.currentTarget.getBoundingClientRect();
							const mx = e.clientX - rect.left + v.panX, my = e.clientY - rect.top + v.panY;
							const zoom = Math.max(0.05, Math.min(8, v.zoom * factor));
							const k = zoom / v.zoom;
							actions.setView({ zoom, panX: mx - (mx - v.panX) * k, panY: my - (my - v.panY) * k });
						} else {
							actions.setView({ panX: v.panX - e.deltaX, panY: v.panY - e.deltaY });
						}
					},
					onDoubleClick: (e) => {
						const pt = controller.toDoc(e);
						const picked=actions.pickObject(page,pt,{deep:true});if(picked?.node&&typeof picked.node.text!=='string'){actions.selectNative(picked.layer,[picked.node.id]);return;}if(picked?.node&&typeof picked.node.text==='string'){actions.selectNative(picked.layer,[picked.node.id]);actions.editNativeText();return;}
						const hit = hitTest(page, pt.x, pt.y);
						if (hit && hit.type === 'text') { actions.select(hit.id); actions.editText(hit.id); }
					}
				}),
        s.ui.nativeTextEditor?h('div',{style:{position:'absolute',left:s.ui.nativeTextEditor.bounds.x*s.ui.zoom,top:s.ui.nativeTextEditor.bounds.y*s.ui.zoom,zIndex:20,background:'var(--dc-surface)',padding:6,border:'1px solid var(--dc-accent)',minWidth:180}},
          h('textarea',{'aria-label':'画布原生文字',disabled:s.nativeBusy,className:'dcTextarea',autoFocus:true,value:s.ui.nativeTextEditor.text,onChange:e=>store.set({ui:{...store.get().ui,nativeTextEditor:{...store.get().ui.nativeTextEditor,text:e.target.value}}})}),
          h('button',{className:'dcBtn dcPrimary',disabled:s.nativeBusy,onClick:()=>actions.commitNativeEdit({text:store.get().ui.nativeTextEditor.text})},'应用源文字'),
          h('button',{className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,nativeTextEditor:null}})},'取消')):null,
				editing ? h('textarea', {
					className: 'dcTextEditor',
					style: {
						left: editing.x * s.ui.zoom, top: editing.y * s.ui.zoom,
						width: Math.max(60, editing.w * s.ui.zoom), height: Math.max(40, editing.h * s.ui.zoom),
						font: `${editing.italic ? 'italic ' : ''}${editing.bold ? '600 ' : ''}${editing.fontSize * s.ui.zoom}px ${editing.fontFamily || 'sans-serif'}`,
						color: editing.color, lineHeight: editing.lineHeight || 1.4,
						textAlign: editing.align || 'left'
					},
					defaultValue: editing.text,
					autoFocus: true,
					onKeyDown: (e) => { if (e.key === 'Escape') actions.commitText(editing.id, e.target.value); },
					onBlur: (e) => actions.commitText(editing.id, e.target.value)
				}) : null
			),
            s.renderError?h('div',{role:'alert',style:{position:'absolute',left:10,top:10,zIndex:5,background:'#fff4e5',padding:8}},'预览未更新：'+s.renderError):null,
			h('div', { style: { position: 'absolute', right: 12, top: 10, display: 'flex', gap: 6 } },
				h('button', { className: 'dcBtn dcIcon', title: '适应窗口', onClick: () => actions.fitToView(wrapRef.current) }, h(Icon, { name: 'zoom', size: 14 }))),
			s.wandMask&&(s.wandMask.previewUrl||s.wandMask.native) ? h('div', { style: { position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 6, alignItems: 'center', background: 'rgba(255,255,255,.92)', borderRadius: 9, padding: '6px 9px', border: '1px solid var(--dc-line)' } },
				s.wandMask.previewUrl?h('img',{src:s.wandMask.previewUrl,style:{width:46,height:34,objectFit:'contain'},alt:''}):null,
				h('span',{className:'dcHint'},s.wandMask.native?'PhotoCraft 原生选区':'魔棒选区'),
				h('button', { className: 'dcBtn', onClick: () => actions.fillWandSelection(store.get().ui.fillStyle) }, '填充'),
				h('button', { className: 'dcBtn', onClick: actions.deleteWandSelection }, '删除'),
				h('button', { className: 'dcBtn dcIcon', onClick: actions.clearWandSelection }, h(Icon, { name: 'close', size: 12 }))
			) : null,
			s.ui.cropRect ? h('div', { style: { position: 'absolute', left: 10, bottom: 10, display: 'flex', gap: 6, background: 'rgba(255,255,255,.92)', borderRadius: 9, padding: '6px 9px', border: '1px solid var(--dc-line)' } },
				h('span', { className: 'dcHint' }, '裁剪 ' + Math.round(s.ui.cropRect.w) + '×' + Math.round(s.ui.cropRect.h)),
				h('button', { className: 'dcBtn dcPrimary', onClick: actions.applyCrop }, '应用'),
				h('button', { className: 'dcBtn', onClick: () => actions.setCropRect(null) }, '取消')
			) : null
		);
	}

	/* ---------------- layers panel ---------------- */

	function LayerRow({ layer, depth }) {
		const s = useStore();
		const active = s.ui.selectedId === layer.id;
		return h('div', null,
			h('div', {
				className: 'dcLayerItem' + (active ? ' dcActive' : ''),
				onClick: e => actions.selectWhole(layer.id,{toggle:e.shiftKey}),
				title: layer.name
			},
				h('span', { className: 'dcLType' }, ({ native:'原生对象', image: '图片', text: '文字', shape: '形状', vector: '矢量', table: '表格', chart: '图表', adjustment: '调整', group: '组', instance: '组件' })[layer.type] || layer.type),
				h('span', { className: 'dcLName' }, layer.name || layer.id),
				layer.hidden ? h(Icon, { name: 'eyeOff', size: 12 }) : null,
				layer.locked ? h(Icon, { name: 'lock', size: 11 }) : null,
				h('button', { className: 'dcBtn dcIcon', style: { width: 22, height: 22 }, title: '上移一层', onClick: (e) => { e.stopPropagation(); actions.reorderLayer(layer.id, 1); } }, h(Icon, { name: 'up', size: 11 })),
				h('button', { className: 'dcBtn dcIcon', style: { width: 22, height: 22 }, title: '下移一层', onClick: (e) => { e.stopPropagation(); actions.reorderLayer(layer.id, -1); } }, h(Icon, { name: 'down', size: 11 }))
			),
			layer.type === 'group' && layer.children?.length ? h('div', { className: 'dcLayerChildren' }, layer.children.map(child => h(LayerRow, { key: child.id, layer: child, depth: depth + 1 }))) : null
		);
	}

	function LayersPanel() {
		const s = useStore();
		const page = s.doc?.pages?.find(p => p.id === s.ui.pageId) || s.doc?.pages?.[0];
		if (!page) return null;
		const layers = [...(page.layers || [])].reverse();
		return h('div', { className: 'dcPanelScroll' },
			h('div', { className: 'dcSectionTitle' }, '图层（上→下）'),
			layers.length ? layers.map(layer => h(LayerRow, { key: layer.id, layer, depth: 0 })) : h('div', { className: 'dcHint' }, '暂无图层 — 用左侧工具开始创作，或从资产库/模板添加'),
			h('div', { className: 'dcSectionTitle' }, '页面'),
			h('div', { className: 'dcRow' },
				h('button', { className: 'dcBtn', onClick: () => actions.duplicatePage(page.id) }, '复制页'),
				h('button', { className: 'dcBtn', disabled: (s.doc?.pages?.length || 0) <= 1, onClick: () => actions.deletePage(page.id) }, '删除页')),
			h('div', { className: 'dcRow' },
				h('button', { className: 'dcBtn dcIcon', title: '页上移', onClick: () => actions.movePage(page.id, -1) }, h(Icon, { name: 'up', size: 13 })),
				h('button', { className: 'dcBtn dcIcon', title: '页下移', onClick: () => actions.movePage(page.id, 1) }, h(Icon, { name: 'down', size: 13 }))),
			h('div', { className: 'dcField' }, h('label', null, '页面名'), h('input', { className: 'dcInput', value: page.name || '', onChange: (e) => actions.updatePage({ name: e.target.value }) })),
			page.native?.engine==='deckcraft'?h('p',{className:'dcHint'},'背景由原生底稿提供，可在原生编辑选项中设置。'):h('div', { className: 'dcField' }, h('label', null, '背景色'), h('input', { type: 'color', className: 'dcColorSwatch', value: typeof page.background === 'string' ? page.background : (page.background?.color || '#FFFFFF'), onChange: (e) => actions.updatePage({ background: { kind: 'solid', color: e.target.value } }) })),
			h('div', { className: 'dcSectionTitle' }, '演讲者备注'),
			h('textarea', { className: 'dcTextarea', value: page.notes || '', placeholder: '本页备注（导出 PPTX 会写入演讲者备注）', onChange: (e) => actions.updatePage({ notes: e.target.value }) }),
			page.transition ? h('div', { className: 'dcField' },
				h('label', null, '转场'),
				h('select', { className: 'dcSelect', value: page.transition.kind || 'fade', onChange: (e) => actions.updatePage({ transition: { ...page.transition, kind: e.target.value } }) },
					['none', 'fade', 'slide', 'wipe', 'morph'].map(k => h('option', { key: k, value: k }, { none: '无', fade: '淡入', slide: '推入', wipe: '擦除', morph: 'Morph（仅原生文件，本地不播放）' }[k])))) : null
		);
	}

	/* ---------------- inspector ---------------- */

	function AdjustPanel({ layer }) {
		const adjust = layer.adjust || {};
		const set = (key, value) => {
			const next = { ...adjust, [key]: value };
			if (value === 0 || value === false || value === '') delete next[key];
			updateLayerFieldsSafe(layer, { adjust: next });
		};
		const slider = (key, label, min, max, step = 0.01) => h('div', { className: 'dcField', key },
			h('label', null, label),
			h('input', { type: 'range', className: 'dcSlider', min, max, step, value: adjust[key] ?? 0, onChange: (e) => set(key, parseFloat(e.target.value)) }),
			h('span', { className: 'dcHint', style: { width: 34, textAlign: 'right' } }, (adjust[key] ?? 0).toFixed(2)));
		const filters = layer.filters || [];
		return h('div', null,
			h('div', { className: 'dcSectionTitle' }, '图像调整（非破坏）'),
			h('div', { className: 'dcAdjustGrid' },
				slider('brightness', '亮度', -1, 1),
				slider('contrast', '对比度', -1, 1),
				slider('exposure', '曝光', -2, 2, 0.05),
				slider('saturation', '饱和度', -1, 1),
				slider('hue', '色相', -180, 180, 1),
				slider('temperature', '色温', -1, 1),
				slider('tint', '色调', -1, 1),
				slider('highlights', '高光', -1, 1),
				slider('shadows', '阴影', -1, 1)),
			h('div', { className: 'dcRow' },
				h('label', { className: 'dcChip' + (adjust.invert ? ' dcActive' : '') }, h('input', { type: 'checkbox', checked: !!adjust.invert, onChange: (e) => set('invert', e.target.checked) }), '反相'),
				h('label', { className: 'dcChip' + (adjust.grayscale ? ' dcActive' : '') }, h('input', { type: 'checkbox', checked: !!adjust.grayscale, onChange: (e) => set('grayscale', e.target.checked) }), '黑白'),
				h('label', { className: 'dcChip' + (adjust.sepia ? ' dcActive' : '') }, h('input', { type: 'checkbox', checked: !!adjust.sepia, onChange: (e) => set('sepia', e.target.checked) }), '复古')),
			h('div', { className: 'dcSectionTitle' }, '滤镜'),
			h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 8 } },
				['blur', 'sharpen', 'pixelate', 'noise', 'vignette'].map(kind => {
					const existing = filters.findIndex(f => f.kind === kind);
					return h('button', { key: kind, className: 'dcChip' + (existing >= 0 ? ' dcActive' : ''), onClick: () => {
						const next = [...filters];
						if (existing >= 0) next.splice(existing, 1);
						else next.push({ kind, amount: kind === 'blur' ? 4 : 30 });
						updateLayerFieldsSafe(layer, { filters: next });
					} }, { blur: '模糊', sharpen: '锐化', pixelate: '像素化', noise: '噪点', vignette: '晕影' }[kind]);
				})),
			filters.map((f, i) => h('div', { className: 'dcField', key: i },
				h('label', null, { blur: '模糊量', sharpen: '锐化量', pixelate: '块大小', noise: '噪声', vignette: '强度' }[f.kind] || f.kind),
				h('input', { type: 'range', className: 'dcSlider', min: 1, max: 100, value: f.amount ?? 4, onChange: (e) => {
					const next = [...filters];
					next[i] = { ...f, amount: parseFloat(e.target.value) };
					updateLayerFieldsSafe(layer, { filters: next });
				} })))
		);
	}

	function updateLayerFieldsSafe(layer, patch) {
		actions.updateLayerFields(patch);
		invalidateLayerCache(layer.id);
		store.set({ paintRev: (store.get().paintRev || 0) + 1 });
		sync.markLocalEdit();
		sync.scheduleSave();
	}

	function StylePanel({ layer }) {
		const style = layer.style || {};
		const set = (patch) => updateLayerFieldsSafe(layer, { style: { ...style, ...patch } });
		return h('div', null,
			h('div', { className: 'dcSectionTitle' }, '图层样式'),
			h('div', { className: 'dcField' },
				h('label', null, '投影'),
				h('select', { className: 'dcSelect', value: style.shadow && style.shadow !== 'none' ? 'on' : 'off', onChange: (e) => set({ shadow: e.target.value === 'on' ? { color: 'rgba(0,0,0,0.35)', blur: 12, distance: 4, angle: 90 } : null }) },
					h('option', { value: 'off' }, '无'),
					h('option', { value: 'on' }, '开启'))),
			style.shadow && style.shadow !== 'none' ? h('div', null,
				h('div', { className: 'dcField' }, h('label', null, '模糊'), h('input', { type: 'range', className: 'dcSlider', min: 0, max: 60, value: style.shadow.blur ?? 12, onChange: (e) => set({ shadow: { ...style.shadow, blur: parseFloat(e.target.value) } }) })),
				h('div', { className: 'dcField' }, h('label', null, '距离'), h('input', { type: 'range', className: 'dcSlider', min: 0, max: 40, value: style.shadow.distance ?? 4, onChange: (e) => set({ shadow: { ...style.shadow, distance: parseFloat(e.target.value) } }) }))
			) : null,
			h('div', { className: 'dcField' },
				h('label', null, '发光'),
				h('select', { className: 'dcSelect', value: style.glow && style.glow !== 'none' ? 'on' : 'off', onChange: (e) => set({ glow: e.target.value === 'on' ? { color: '#8CCFBC', radius: 10 } : null }) },
					h('option', { value: 'off' }, '无'),
					h('option', { value: 'on' }, '开启'))),
			h('div', { className: 'dcSectionTitle' }, '混合模式'),
			h('select', { className: 'dcSelect', value: layer.blend || 'normal', onChange: (e) => updateLayerFieldsSafe(layer, { blend: e.target.value }) },
				BLEND_MODES.map(m => h('option', { key: m, value: m }, m))),
			h('div', { className: 'dcSectionTitle' }, '蒙版'),
			h('select', { className: 'dcSelect', value: layer.mask?.kind || 'none', onChange: (e) => updateLayerFieldsSafe(layer, { mask: e.target.value === 'none' ? null : { kind: e.target.value } }) },
				h('option', { value: 'none' }, '无'),
				h('option', { value: 'rect' }, '矩形裁切'),
				h('option', { value: 'ellipse' }, '椭圆裁切'),
				h('option', { value: 'luminance' }, '亮度蒙版（需蒙版图资产）')),
			layer.mask?.kind === 'luminance' ? h('div', { className: 'dcField' }, h('label', null, '蒙版图'), h('input', { className: 'dcInput', value: typeof layer.mask.asset === 'string' ? layer.mask.asset : layer.mask.asset?.src || '', placeholder: 'assets/mask.png', onChange: (e) => updateLayerFieldsSafe(layer, { mask: { ...layer.mask, asset: e.target.value } }) })) : null
		);
	}

  function SelectionTools(){
    const s=useStore(),native=selectedNative(s),count=native?native.nodes.length:selectedIds(s).length;if(!count)return null;
    return h('div',{className:'dcRow',style:{padding:'5px 8px',flexWrap:'wrap',borderBottom:'1px solid var(--dc-line)'}},
      h('span',{className:'dcHint'},'已选 '+count+(native?' 个源对象':' 个对象')),
      native?.layer.native.engine==='deckcraft'&&native.nodes.length===1&&native.nodes[0].kind==='picture'?h('button',{className:'dcBtn dcPrimary',disabled:!!s.mediaBusy,onClick:actions.openLinkedMedia},s.mediaBusy?'正在打开图片源…':'编辑这张图片'):null,
      native&&native.layer.native.engine!=='deckcraft'?h('button',{className:'dcBtn',onClick:()=>actions.selectWhole(native.layer.id)},'返回整体对象'):null,
      h('label',{className:'dcHint'},h('input',{type:'checkbox',checked:!!s.ui.alignToPage,onChange:e=>store.set({ui:{...store.get().ui,alignToPage:e.target.checked}})}),'按画板'),
      ...Object.entries({left:'左对齐',centerX:'水平居中',right:'右对齐',top:'顶对齐',centerY:'垂直居中',bottom:'底对齐',distributeX:'水平等距',distributeY:'垂直等距'}).map(([mode,label])=>h('button',{key:mode,className:'dcBtn',disabled:s.nativeBusy||((mode.startsWith('distribute')?count<3:count<2&&!s.ui.alignToPage)),onClick:()=>actions.alignSelection(mode,!!store.get().ui.alignToPage)},label)),
      !native?h('button',{className:'dcBtn',disabled:count<2,onClick:()=>actions.groupSelection()},'编组'):null,
      !native?h('button',{className:'dcBtn',onClick:()=>actions.groupSelection(true)},'解组'):null);
  }

  function NativeCommandPanel({layer}){
    const s=useStore(),[commands,setCommands]=useState(null),[selected,setSelected]=useState(''),[params,setParams]=useState('{}'),[object,setObject]=useState('');
    const engine=layer.native?.engine||'photocraft',command=commands?.find(item=>item.id===selected);
    const nodes=engine==='photocraft'?layer.native?.layers||[]:layer.native?.nodes||[];
    const target=Number((s.ui.nativeSelection?.layerId===layer.id?s.ui.nativeSelection.ids[0]:object)||nodes.find(item=>item.kind==='Pixel'||item.kind==='Path')?.id||nodes[0]?.id);
    return h('div',null,
      h('button',{className:'dcBtn',disabled:s.nativeBusy,onClick:async()=>{const result=await sync.nativeOperation({operation:'native.inspect',layerId:layer.id});setCommands(result.candidate.commands.filter(item=>engine==='photocraft'?/^(image\.adjustments\.|filter\.|select\.|paint\.|layer\.|edit\.(fill|clear)$)/.test(item.id):engine==='deckcraft'?/^(shape\.|text\.|format\.|table\.|chart\.|insert\.|animation\.|transition\.|slide\.notes$|design\.(background|colors|fonts|theme|effects|variant)$|edit\.delete$)/.test(item.id):/^(path\.|paint\.|object\.|select\.|text\.)/.test(item.id)));}},'原生编辑选项'),
      commands?h('div',null,
        h('select',{className:'dcSelect','aria-label':'原生目标对象',value:String(s.ui.nativeSelection?.layerId===layer.id?s.ui.nativeSelection.ids[0]:target||''),onChange:e=>{setObject(e.target.value);actions.selectNative(layer,[Number(e.target.value)]);}},...nodes.map(item=>h('option',{key:item.id,value:item.id},item.name+' · '+item.kind+' #'+item.id))),
        h('select',{className:'dcSelect','aria-label':'原生命令',value:selected,onChange:e=>setSelected(e.target.value)},h('option',{value:''},'选择引擎提供的真实操作'),...commands.map(item=>h('option',{key:item.id,value:item.id},item.label+' · '+item.id))),
        command?h('p',{className:'dcHint',style:{whiteSpace:'pre-wrap',maxHeight:160,overflow:'auto'}},command.params):null,
        h('textarea',{className:'dcTextarea','aria-label':'原生命令参数',value:params,onChange:e=>setParams(e.target.value)}),
        h('button',{className:'dcBtn',disabled:!selected||s.nativeBusy,onClick:async()=>{let parsed;try{parsed=JSON.parse(params);}catch{throw new Error('原生命令参数不是有效 JSON');}await sync.nativeOperation({operation:engine==='photocraft'?'photo.apply':engine==='deckcraft'?'deck.apply':'vector.apply',layerId:layer.id,...(engine==='photocraft'?{nativeLayerId:target}:{nativeObjectId:target}),commands:[{id:selected,params:parsed}]});}},'执行原生编辑')
      ):null
    );
  }

  function NativeObjectTools({layer,page}){
    const s=useStore(),[other,setOther]=useState(''),[mode,setMode]=useState('unite'),[brightness,setBrightness]=useState(0),[radius,setRadius]=useState(2),[nativeLayer,setNativeLayer]=useState('');
    const flat=layers=>(layers||[]).flatMap(l=>l.type==='group'?flat(l.children):[l]);
    const candidates=flat(page.layers).filter(l=>l.id!==layer.id&&['shape','vector'].includes(l.type));
    const target=s.ui.nativeTargets?.[layer.id]??((layer.native?.layers||[]).find(item=>String(item.id)===nativeLayer)?.id||(layer.native?.layers||[]).find(item=>item.kind==='Pixel')?.id);
    const call=operation=>sync.nativeOperation({...operation,...(operation.operation==='photo.apply'&&target!=null?{nativeLayerId:target}:{})});
    return h('div',null,
      h('div',{className:'dcSectionTitle'},'专业对象编辑'),
      selectedNative(s)?.nodes.length===1&&typeof selectedNative(s).nodes[0].text==='string'?h('button',{className:'dcBtn',onClick:actions.editNativeText},'编辑选中源文字'):null,
      layer.native?.source?h('a',{className:'dcBtn',href:sync.assetUrl(layer.native.source),download:layer.native.source},layer.type==='vector'?'下载导入/运算源文件':layer.native?.engine==='deckcraft'?'下载原生底稿':'下载可编辑源文件'):null,
      layer.type==='native'?h('div',null,h('p',{className:'dcHint'},'原始文件和原生源文件已保留。画布显示引擎预览，可用下面的原生选项编辑实际对象。'),layer.native?.svg?h('a',{className:'dcBtn',href:sync.assetUrl(layer.native.svg),download:layer.native.svg},'下载原生 SVG'):null):null,
      layer.type==='image'?h('div',null,
        h('div',{className:'dcHint'},'PhotoCraft 原图操作；结果返回此图层，保留分层源文件与操作历史。'),
        layer.native?.layers?.length?h('select',{className:'dcSelect','aria-label':'图片源文件图层',value:String(target||''),onChange:e=>{setNativeLayer(e.target.value);actions.selectNative(layer,[Number(e.target.value)]);}},...layer.native.layers.map(item=>h('option',{key:item.id,value:item.id},item.name+' · '+item.kind))):null,
        h('button',{className:'dcBtn',disabled:s.nativeBusy,onClick:()=>call({operation:'photo.apply',layerId:layer.id,commands:[{id:'image.adjustments.invert'}]})},'原生反相'),
        h(NumberField,{label:'原图亮度',value:brightness,min:-150,max:150,onChange:setBrightness}),
        h('button',{className:'dcBtn',disabled:s.nativeBusy,onClick:()=>call({operation:'photo.apply',layerId:layer.id,commands:[{id:'layer.newAdjustmentLayer.brightnessContrast',params:{brightness,contrast:0}}]})},'添加原生亮度调整层'),
        h(NumberField,{label:'模糊半径',value:radius,min:.1,max:100,onChange:setRadius}),
        h('button',{className:'dcBtn',disabled:s.nativeBusy,onClick:()=>call({operation:'photo.apply',layerId:layer.id,commands:[{id:'filter.blur.gaussianBlur',params:{radius}}]})},'原生高斯模糊')
      ):null,
      ['shape','vector'].includes(layer.type)?h('div',null,
        h('div',{className:'dcHint'},'VectorCraft 几何运算；返回可编辑路径。'),
        h('select',{className:'dcSelect','aria-label':'布尔运算第二图层',value:other,onChange:e=>setOther(e.target.value)},h('option',{value:''},'选择另一个图层'),...candidates.map(l=>h('option',{key:l.id,value:l.id},l.name||l.id))),
        h('select',{className:'dcSelect','aria-label':'布尔运算方式',value:mode,onChange:e=>setMode(e.target.value)},...Object.entries({unite:'合并',subtract:'减去',intersect:'相交',exclude:'排除',divide:'分割'}).map(([id,label])=>h('option',{key:id,value:id},label))),
        h('button',{className:'dcBtn',disabled:!other||s.nativeBusy,onClick:()=>call({operation:'vector.boolean',mode,layerIds:[layer.id,other]})},'执行原生布尔运算')
      ):null,
      (layer.type==='image'||layer.type==='native')?h(NativeCommandPanel,{layer}):null,
      s.nativeBusy?h('div',{className:'dcHint'},'专业引擎正在处理…可在后台任务中取消。'):null,
      s.nativeWarning?h('div',{className:'dcHint',role:'status'},s.nativeWarning,h('button',{className:'dcBtn',onClick:()=>store.set({nativeWarning:null})},'关闭')):null,
      s.nativeError?h('div',{className:'dcHint',role:'alert'},s.nativeError):null,
      s.nativeCandidate?.source?h('a',{href:sync.assetUrl(s.nativeCandidate.source),download:s.nativeCandidate.source},'下载未覆盖作品的运算结果'):null
    );
  }

  function ToolOptions(){
    const s=useStore(),tool=s.ui.tool,set=patch=>store.set({ui:{...store.get().ui,...patch}});
    const page=s.doc?.pages.find(p=>p.id===s.ui.pageId)||s.doc?.pages[0],layer=page&&actions.findLayerDeep(page.layers,s.ui.selectedId)?.layer;
    if(!['brush','eraser','fill','gradient','pen','shape','magicwand'].includes(tool))return null;
    return h('div',{style:{padding:12,borderBottom:'1px solid var(--dc-line)'}},
      h('div',{className:'dcSectionTitle'},'当前工具'),
      !['magicwand','eraser'].includes(tool)?h(ColorField,{value:s.ui.fillStyle,onChange:value=>set({fillStyle:value})}):null,
      ['brush','eraser'].includes(tool)?h('div',null,h(NumberField,{label:'画笔大小',value:s.ui.brushSize||18,min:1,max:5000,onChange:value=>set({brushSize:Math.max(1,Math.min(5000,value))})}),h(NumberField,{label:'画笔透明度',value:s.ui.brushOpacity??1,min:0,max:1,step:.05,onChange:value=>set({brushOpacity:Math.max(0,Math.min(1,value))})})):null,
      tool==='gradient'?h(ColorField,{value:s.ui.gradientEnd||'#FFFFFF',onChange:value=>set({gradientEnd:value})}):null,
      tool==='magicwand'?h('div',null,h(NumberField,{label:'容差',value:s.ui.wandTolerance??32,min:0,max:255,onChange:value=>set({wandTolerance:Math.max(0,Math.min(255,value))})}),layer?.native?.engine==='photocraft'?h('div',null,
        h('label',null,h('input',{type:'checkbox',checked:s.ui.wandAntiAlias!==false,onChange:e=>set({wandAntiAlias:e.target.checked})}),'边缘抗锯齿'),
        h('label',null,h('input',{type:'checkbox',checked:s.ui.wandSampleAll===true,onChange:e=>set({wandSampleAll:e.target.checked})}),'对所有可见图层采样')):h('p',{className:'dcHint'},'普通位图使用硬边选区。')):null,
      ['brush','eraser'].includes(tool)&&layer?.native?.engine==='photocraft'?h('p',{className:'dcHint'},'笔画先记录轨迹，结束后由 PhotoCraft 计算并保存分层结果。'):null
    );
  }

  function NativeDeckProperties({layer}){
    const s=useStore(),nodes=layer.native.nodes||[],[target,setTarget]=useState(''),[text,setText]=useState(''),[box,setBox]=useState([0,0,100,100]),[color,setColor]=useState('#287D6C'),[size,setSize]=useState(18);
    const selected=nodes.find(node=>Number(node.id)===(s.ui.nativeSelection?.layerId===layer.id?s.ui.nativeSelection.ids[0]:Number(target)))||nodes[0];
    useEffect(()=>{setText(selected?.text||'');setBox(selected?.box||[0,0,100,100]);},[selected?.id,layer.native.source]);
    const run=(id,params)=>sync.nativeOperation({operation:'deck.apply',layerId:layer.id,nativeObjectId:selected?.id,commands:[{id,params}]});
    return h('div',null,h('div',{className:'dcSectionTitle'},'演示源对象'),h('p',{className:'dcHint'},'画布为静态预览；动画与母版保留在原生演示和 PPTX 中。'),
      h('select',{className:'dcSelect','aria-label':'演示原生对象',value:String(selected?.id||''),onChange:e=>{setTarget(e.target.value);actions.selectNative(layer,[Number(e.target.value)]);}},...nodes.map(node=>h('option',{key:node.id,value:node.id},node.name+' · '+node.kind+' #'+node.id))),
      layer.native.nodesLimited?h('p',{className:'dcHint'},'对象列表有截断，部分对象需重新检查源。'):null,
      selected?.text!=null?h('div',null,h('textarea',{className:'dcTextarea','aria-label':'原生演示文字',value:text,disabled:selected.textTruncated,onChange:e=>setText(e.target.value)}),selected.textTruncated?h('p',{className:'dcHint'},'长文本这里只显示摘要，请通过原生命令读取和编辑。'):h('button',{className:'dcBtn',disabled:s.nativeBusy,onClick:()=>run('text.set',{id:selected.id,text})},'应用原生文字')):null,
      h('div',{className:'dcSectionTitle'},'源对象位置（pt）'),
      ...['X','Y','宽','高'].map((label,index)=>h(NumberField,{key:label,label,value:box[index],onChange:value=>setBox(box.map((old,n)=>n===index?value:old))})),
      h('button',{className:'dcBtn',disabled:!selected||s.nativeBusy,onClick:()=>run('shape.sizePosition',{ids:[selected.id],x:box[0],y:box[1],w:Math.max(.1,box[2]),h:Math.max(.1,box[3])})},'应用原生位置'),
      h(ColorField,{value:color,onChange:setColor}),h('button',{className:'dcBtn',disabled:!selected||s.nativeBusy,onClick:()=>run('shape.fill',{ids:[selected.id],color})},'应用形状填充'),
      h(NumberField,{label:'新字号（pt）',value:size,onChange:setSize}),h('button',{className:'dcBtn',disabled:!selected||s.nativeBusy,onClick:()=>run('format.fontDialog',{size,color})},'应用文字格式')
    );
  }

	function Inspector() {
		const s = useStore();
		const page = s.doc?.pages?.find(p => p.id === s.ui.pageId) || s.doc?.pages?.[0];
		const layer = page && s.ui.selectedId ? actions.findLayerDeep(page.layers, s.ui.selectedId)?.layer : null;
		const [tab, setTab] = useState('props');
		if (!layer) {
			return h('div', { className: 'dcPanelScroll' }, h('div', { className: 'dcHint' }, '选中图层后在此编辑属性。快捷键：V 移动 · A 节点 · T 文字 · S 形状 · B 画笔 · P 钢笔 · Ctrl+Z 撤销'));
		}
        if(layer.type==='native'&&layer.native?.engine==='deckcraft'&&layer.native.role==='page')return h('div',{className:'dcPanelScroll'},h(NativeDeckProperties,{key:layer.id,layer}),h(NativeObjectTools,{layer,page}));
		const geo = h('div', null,
			h('div', { className: 'dcSectionTitle' }, '几何'),
			h('div', { className: 'dcRow' },
				h(NumberField, { label: 'X', value: Math.round(layer.x), onChange: (v) => updateLayerFieldsSafe(layer, { x: v }) }),
				h(NumberField, { label: 'Y', value: Math.round(layer.y), onChange: (v) => updateLayerFieldsSafe(layer, { y: v }) })),
			h('div', { className: 'dcRow' },
				h(NumberField, { label: '宽', value: Math.round(layer.w), onChange: (v) => updateLayerFieldsSafe(layer, { w: Math.max(1, v) }) }),
				h(NumberField, { label: '高', value: Math.round(layer.h), onChange: (v) => updateLayerFieldsSafe(layer, { h: Math.max(1, v) }) })),
			h('div', { className: 'dcRow' },
				h(NumberField, { label: '旋转', value: layer.rotation || 0, onChange: (v) => updateLayerFieldsSafe(layer, { rotation: v }), step: 5 }),
				h(NumberField, { label: '不透明度', value: layer.opacity ?? 1, onChange: (v) => updateLayerFieldsSafe(layer, { opacity: Math.max(0, Math.min(1, v)) }), step: 0.05, min: 0, max: 1 })));

		let typeSpecific = null;
		if (layer.type === 'text') {
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '文字'),
				h('textarea', { className: 'dcTextarea', value: layer.text || '', onChange: (e) => updateLayerFieldsSafe(layer, { text: e.target.value }) }),
				h('div', { className: 'dcRow' },
					h(NumberField, { label: '字号', value: layer.fontSize, onChange: (v) => updateLayerFieldsSafe(layer, { fontSize: Math.max(4, v) }) }),
					h('div', { className: 'dcField' }, h('label', null, '行高'), h('input', { type: 'number', className: 'dcInput', step: 0.1, value: layer.lineHeight, onChange: (e) => updateLayerFieldsSafe(layer, { lineHeight: parseFloat(e.target.value) || 1.4 }) }))),
				h('div', { className: 'dcRow' },
					h('button', { className: 'dcBtn' + (layer.bold ? ' dcActive' : ''), onClick: () => updateLayerFieldsSafe(layer, { bold: !layer.bold }) }, 'B'),
					h('button', { className: 'dcBtn' + (layer.italic ? ' dcActive' : ''), onClick: () => updateLayerFieldsSafe(layer, { italic: !layer.italic }) }, 'I'),
					h('button', { className: 'dcBtn' + (layer.bullets ? ' dcActive' : ''), onClick: () => updateLayerFieldsSafe(layer, { bullets: !layer.bullets }) }, '• 列表'),
					h('select', { className: 'dcSelect', value: layer.align, onChange: (e) => updateLayerFieldsSafe(layer, { align: e.target.value }) }, ['left', 'center', 'right'].map(a => h('option', { key: a, value: a }, { left: '左', center: '中', right: '右' }[a])))),
				h(ColorField, { value: layer.color, onChange: (v) => updateLayerFieldsSafe(layer, { color: v }) }),
				h('div', { className: 'dcField' }, h('label', null, '字体'), h('input', { className: 'dcInput', value: layer.fontFamily || '', onChange: (e) => updateLayerFieldsSafe(layer, { fontFamily: e.target.value }) })));
		} else if (layer.type === 'image') {
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '图片'),
				h('div', { className: 'dcHint', style: { marginBottom: 6 } }, '资产: ' + (typeof layer.asset === 'string' ? layer.asset : layer.asset?.src || '未设置')),
				h('div', { className: 'dcRow' },
					h('button', { className: 'dcBtn', onClick: () => { const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*'; input.onchange = async () => { try { if (input.files[0]) { const r = await sync.uploadAsset(input.files[0]); updateLayerFieldsSafe(layer, { asset: r.name }); } } catch(error) { actions.toast(error.message); } }; input.click(); } }, '替换图片'),
					h('button', { className: 'dcBtn', onClick: () => updateLayerFieldsSafe(layer, { transform: { ...(layer.transform || {}), flipH: !(layer.transform?.flipH) } }) }, '水平翻转'),
					h('button', { className: 'dcBtn', onClick: () => updateLayerFieldsSafe(layer, { transform: { ...(layer.transform || {}), flipV: !(layer.transform?.flipV) } }) }, '垂直翻转')),
				layer.native?.engine==='photocraft'&&!layer.adjust&&!layer.filters?null:h('div',null,h('p',{className:'dcHint'},'保留的画布外观调整；原生图像编辑位于下方。'),h(AdjustPanel,{layer})));
		} else if (layer.type === 'shape') {
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '形状'),
				h('div', { className: 'dcField' }, h('label', null, '预设'), h('select', { className: 'dcSelect', value: layer.shape, onChange: (e) => updateLayerFieldsSafe(layer, { shape: e.target.value }) }, SHAPE_PRESETS.map(p => h('option', { key: p, value: p }, p)))),
				h(ColorField, { value: layer.fill, onChange: (v) => updateLayerFieldsSafe(layer, { fill: v }), allowNone: true }),
				h('div', { className: 'dcField' }, h('label', null, '描边'), h('input', { type: 'color', className: 'dcColorSwatch', value: typeof layer.stroke === 'string' ? layer.stroke : (layer.stroke?.color || '#202936'), onChange: (e) => updateLayerFieldsSafe(layer, { stroke: { color: e.target.value, width: layer.stroke?.width ?? 2 } }) }), h('input', { type: 'number', className: 'dcInput', value: layer.stroke?.width ?? 0, min: 0, onChange: (e) => updateLayerFieldsSafe(layer, { stroke: { color: layer.stroke?.color || '#202936', width: parseFloat(e.target.value) || 0 } }) })),
				layer.shape === 'roundRect' ? h(NumberField, { label: '圆角', value: layer.radius ?? 0.15, step: 0.05, min: 0, max: 0.5, onChange: (v) => updateLayerFieldsSafe(layer, { radius: v }) }) : null,
				h('div', { className: 'dcField' }, h('label', null, '内文'), h('input', { className: 'dcInput', value: layer.text || '', onChange: (e) => updateLayerFieldsSafe(layer, { text: e.target.value }) })));
		} else if (layer.type === 'vector') {
			const first = layer.paths?.[0] || {};
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '矢量路径（' + (layer.paths?.length || 0) + ' 条）'),
				h(ColorField, { value: first.fill || 'none', onChange: (v) => updateLayerFieldsSafe(layer, { paths: layer.paths.map(p => ({ ...p, fill: v === 'none' ? null : v })) }), allowNone: true }),
				h('div', { className: 'dcField' }, h('label', null, '描边'), h('input', { type: 'color', className: 'dcColorSwatch', value: first.stroke?.color || '#202936', onChange: (e) => updateLayerFieldsSafe(layer, { paths: layer.paths.map(p => ({ ...p, stroke: { ...(p.stroke || {}), color: e.target.value } })) }) }), h('input', { type: 'number', className: 'dcInput', value: first.stroke?.width ?? 0, min: 0, step: 0.5, onChange: (e) => updateLayerFieldsSafe(layer, { paths: layer.paths.map(p => ({ ...p, stroke: { ...(p.stroke || { color: '#202936' }), width: parseFloat(e.target.value) || 0 } })) }) })),
				h('div', { className: 'dcField' }, h('label', null, '填充规则'), h('select', { className: 'dcSelect', value: first.fillRule || 'nonzero', onChange: (e) => updateLayerFieldsSafe(layer, { paths: layer.paths.map(p => ({ ...p, fillRule: e.target.value })) }) }, h('option', { value: 'nonzero' }, 'nonzero'), h('option', { value: 'evenodd' }, 'evenodd（镂空）'))),
				h('div', { className: 'dcHint' }, '可从素材面板导入 SVG，复杂外观将保留完整原生源文件。'));
		} else if (layer.type === 'chart') {
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '图表'),
				h('div', { className: 'dcField' }, h('label', null, '类型'), h('select', { className: 'dcSelect', value: layer.chartKind, onChange: (e) => updateLayerFieldsSafe(layer, { chartKind: e.target.value }) }, ['bar', 'line', 'area', 'pie', 'donut'].map(k => h('option', { key: k, value: k }, { bar: '柱状', line: '折线', area: '面积', pie: '饼图', donut: '环形' }[k])))),
				h('div', { className: 'dcField' }, h('label', null, '标题'), h('input', { className: 'dcInput', value: layer.title || '', onChange: (e) => updateLayerFieldsSafe(layer, { title: e.target.value }) })),
				h('div', { className: 'dcField' }, h('label', null, '数据 JSON'), null),
				h('textarea', { className: 'dcTextarea', style: { minHeight: 110 }, defaultValue: JSON.stringify(layer.data, null, 1), onBlur: (e) => { try { updateLayerFieldsSafe(layer, { data: JSON.parse(e.target.value) }); } catch { actions.toast('数据 JSON 不合法'); } } }),
				h('div', { className: 'dcHint' }, '格式 {"labels":[...],"series":[{"name":"..","values":[..]}]}'));
		} else if (layer.type === 'table') {
			typeSpecific = h('div', null,
				h('div', { className: 'dcSectionTitle' }, '表格'),
				h('div', { className: 'dcField' }, h('label', null, '数据 JSON'), null),
				h('textarea', { className: 'dcTextarea', style: { minHeight: 110 }, defaultValue: JSON.stringify(layer.rows, null, 1), onBlur: (e) => { try { updateLayerFieldsSafe(layer, { rows: JSON.parse(e.target.value) }); } catch { actions.toast('表格 JSON 不合法'); } } }),
				h('div', { className: 'dcHint' }, '格式 [["表头1","表头2"],["a","b"]]'));
		} else if (layer.type === 'adjustment') {
			typeSpecific = h(AdjustPanel, { layer });
		}

		return h('div', { className: 'dcPanelScroll' },
			h('div', { className: 'dcField' },
				h('label', null, '名称'),
				h('input', { className: 'dcInput', value: layer.name || '', onChange: (e) => updateLayerFieldsSafe(layer, { name: e.target.value }) })),
			h('div', { className: 'dcRow' },
				h('button', { className: 'dcBtn dcIcon', title: layer.hidden ? '显示' : '隐藏', onClick: () => updateLayerFieldsSafe(layer, { hidden: !layer.hidden }) }, h(Icon, { name: layer.hidden ? 'eyeOff' : 'eye', size: 13 })),
				h('button', { className: 'dcBtn dcIcon', title: layer.locked ? '解锁' : '锁定', onClick: () => updateLayerFieldsSafe(layer, { locked: !layer.locked }) }, h(Icon, { name: 'lock', size: 13 })),
				h('button', { className: 'dcBtn dcIcon', title: '复制 (Ctrl+D)', onClick: actions.duplicateSelection }, h(Icon, { name: 'copy', size: 13 })),
				h('button', { className: 'dcBtn dcIcon', title: '删除 (Del)', onClick: actions.deleteSelection }, h(Icon, { name: 'trash', size: 13 }))),
			geo,
			typeSpecific,
			['image','vector','shape','native'].includes(layer.type)?h(NativeObjectTools,{key:layer.id,layer,page}):null,
			h(StylePanel, { layer })
		);
	}

	/* ---------------- drawers ---------------- */

	function Drawer({ kind, onClose }) {
		const s = useStore();
		const titles = { variants:'作品方案比较',images:'AI 图像与方案',assets: '资产库', templates: '模板库', systems: '设计系统', layouts: '版式库', ai: 'AI 协作', history:'恢复历史版本' };
		return h(React.Fragment, null,
			h('div', { className: 'dcDrawerMask', onClick: onClose }),
			h('div', { className: 'dcDrawer' },
				h('div', { className: 'dcDrawerHead' }, titles[kind] || '', h('button', { className: 'dcBtn dcIcon', onClick: onClose }, h(Icon, { name: 'close', size: 13 }))),
				h('div', { className: 'dcDrawerBody' },
					kind === 'assets' ? h(AssetsDrawer) : null,
                    kind === 'images' ? h(ImagePanel) : null,
                    kind === 'variants' ? h(VariantPanel) : null,
					kind === 'templates' ? h(TemplatesDrawer) : null,
					kind === 'systems' ? h(SystemsDrawer) : null,
					kind === 'layouts' ? h(LayoutsDrawer) : null,
					kind === 'ai' ? h(AiDrawer) : null,
					kind === 'history' ? h(HistoryDrawer) : null))

		);
	}

	function AssetsDrawer() {
		const s = useStore();
		const inputRef = useRef(null);
		return h('div', null,
			h('div', { className: 'dcRow' },
				h('button', { className: 'dcBtn dcPrimary', onClick: () => inputRef.current?.click() }, h(Icon, { name: 'image', size: 14 }), '上传图片'),
				h('button', { className: 'dcBtn', onClick: () => { const input = document.createElement('input'); input.type = 'file'; input.accept = '.svg'; input.multiple = true; input.onchange = () => actions.importSvgFiles([...input.files]); input.click(); } }, '导入 SVG')),
			h('input', { ref: inputRef, type: 'file', accept: 'image/*,.psd,.psb,.pcraft,.vectorcraft,.ai,.pdf', multiple: true, style: { display: 'none' }, onChange: (e) => { actions.importFilesAsLayers([...e.target.files]); e.target.value = ''; } }),
			h('div', { className: 'dcSectionTitle' }, '资产（' + (s.assets || []).length + '）'),
			h('div', { className: 'dcAssetGrid' },
				(s.assets || []).map(a => h('button', {
					key: a.name, className: 'dcAssetItem', title: a.name,
					onClick:()=>actions.addImageLayerFromAsset(a.name)
				}, !/\.(png|jpe?g)$/i.test(a.name) ? h('span', { style: { fontSize: 10 } }, a.name) : h('img', { src: api('designcraft/api/v1/asset?root=' + encodeURIComponent(s.root) + '&name=' + encodeURIComponent(a.name)), alt: a.name, loading: 'lazy' })))),
			h('div', { className: 'dcHint', style: { marginTop: 10 } }, '点击资产插入画布；也可直接拖拽图片文件到画布。AI 通过 asset.addFromFile 添加的文件会出现在这里。')
		);
	}

	function TemplatesDrawer() {
		const s = useStore();
		const [vars, setVars] = useState('');
		const parsedVars = (() => { try { return JSON.parse(vars || '{}'); } catch { return null; } })();
		return h('div', null,
			h('div', { className: 'dcSectionTitle' }, '内置模板'),
			(s.templates || []).map(tpl => h('div', { key: tpl.id, className: 'dcCard' },
				h('h4', null, tpl.name, ' ', h('span', { className: 'dcHint' }, tpl.kind === 'deck' ? '演示' : '画板')),
				h('p', null, tpl.description),
				h('div', { className: 'dcRow', style: { marginTop: 8 } },
					h('button', { className: 'dcBtn dcPrimary', onClick: () => actions.instantiateTemplate(tpl.id, parsedVars || {}) }, '新建文档'),
					h('button', { className: 'dcBtn', disabled: s.doc?.type !== 'deck' && tpl.kind !== 'canvas', onClick: () => actions.appendTemplatePages(tpl.id, parsedVars || {}) }, '追加到当前文档')))),
			h('details',null,h('summary',{className:'dcHint'},'高级模板参数（可选）'),
			h('textarea', { className: 'dcTextarea', placeholder: '{"title":"标题","subtitle":"副标题"}', value: vars, onChange: (e) => setVars(e.target.value) }),
			parsedVars === null ? h('div', { className: 'dcHint', style: { color: '#B44846' } }, 'JSON 格式有误') : null)
		);
	}

  function SystemsDrawer(){
    const s=useStore(),[reference,setReference]=useState(null),[busy,setBusy]=useState(false);
    return h('div',null,
      h('div',{className:'dcSectionTitle'},'OpenDesign 真实资源包'),
      h('p',{className:'dcHint'},'原始设计说明、全部令牌和海报/PPT 参考源均按上游提交校验。画布以令牌文件为准；参考源不会冒充已导入的可编辑作品。'),
      ...(s.designResources||[]).map(item=>h('div',{className:'dcCard',key:item.id},
        h('h4',null,item.name),h('div',{className:'dcRow'},...Object.entries(item.colors).slice(0,6).map(([key,value])=>h('span',{key,title:key+' '+value,style:{display:'inline-block',width:20,height:20,background:value,border:'1px solid #ddd'}}))),
        h('p',{className:'dcHint'},item.tokens+' 个原始令牌 · '+item.revision.slice(0,12)),
        h('button',{className:'dcBtn',disabled:busy,onClick:async()=>{setBusy(true);try{await sync.applyDesignResource(item.id);}finally{setBusy(false);}}},'应用 '+item.name),
        h('button',{className:'dcBtn',onClick:async()=>setReference(await sync.readDesignResource(item.id))},'阅读 '+item.name+' 设计说明'),
        ...item.references.map(file=>h('button',{key:file,className:'dcBtn',onClick:async()=>setReference(await sync.readDesignResource(item.id,file))},file.includes('poster')?'海报参考源':'PPT参考源'))
      )),
      reference?h('div',{className:'dcCard'},h('a',{href:reference.source,target:'_blank',rel:'noreferrer'},reference.id+' / '+reference.file),h('pre',{style:{maxHeight:320,overflow:'auto',whiteSpace:'pre-wrap',fontSize:12}},reference.content)):null,
      h('div',{className:'dcSectionTitle'},'已有本地预设'),
      ...(s.designSystems||[]).map(ds=>h('button',{key:ds.id,className:'dcBtn',onClick:()=>actions.applyDesignSystem(ds.id)},ds.name))
    );
  }

	function LayoutsDrawer() {
		const s = useStore();
		const [varsText, setVarsText] = useState('{}');
		const parsed = (() => { try { return JSON.parse(varsText || '{}'); } catch { return null; } })();
		return h('div', null,
			h('div', { className: 'dcSectionTitle' }, '幻灯片版式'),
			LAYOUT_GALLERY.map(l => h('div', { key: l.id, className: 'dcCard dcClickable', onClick: () => parsed && actions.addLayoutSlide(l.id, parsed) },
				h('h4', null, l.name, ' ', h('span', { className: 'dcHint' }, l.id)),
				h('p', null, l.hint))),
			h('details',null,h('summary',{className:'dcHint'},'高级版式参数（可选）'),
			h('textarea', { className: 'dcTextarea', value: varsText, onChange: (e) => setVarsText(e.target.value) }),
			h('div', { className: 'dcHint' }, '可用：title, subtitle, bullets[], body, leftTitle/leftBullets, rightTitle/rightBullets, imageAsset, chartKind, chart, notes, author'))
		);
	}

  function AiDrawer(){return h('div',null,h('p',null,'在左侧设计对话中直接描述需求，选中对象会显示为本次消息的引用。'),h('button',{className:'dcBtn dcPrimary',onClick:()=>store.set({ui:{...store.get().ui,drawer:null,chatOpen:true,chatFocus:(store.get().ui.chatFocus||0)+1}})},'打开设计对话'));}

  async function previewForChat(snapshot){
    const doc=snapshot.doc,page=doc?.pages?.find(item=>item.id===snapshot.ui.pageId)||doc?.pages?.[0];
    if(!page)throw new Error('当前没有可预览的画板');
    const factor=Math.min(1,1280/doc.canvas.width,1280/doc.canvas.height);
    const canvas=await renderPageToCanvas(page,doc,Math.max(1,Math.round(doc.canvas.width*factor)),Math.max(1,Math.round(doc.canvas.height*factor)));
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
    if(!blob||blob.size>8*1024*1024)throw new Error('画板预览无法编码或超过8MB，请关闭预览附件后重试');
    return new File([blob],'画板预览.png',{type:'image/png'});
  }

  function DesignConversation(props){
    const s=useStore(),session=props.useSession(value=>value),sessionId=props.sessionId;
    const cwd=props.useSessions(value=>sessionId?value.byId[sessionId]?.cwd:undefined);
    const [error,setError]=useState(null),[busy,setBusy]=useState(false),[quoted,setQuoted]=useState(null),[includePreview,setIncludePreview]=useState(true),sequence=useRef(0),composing=useRef(false),[compositionRevision,setCompositionRevision]=useState(0);
    useEffect(()=>{if(cwd&&(!store.get().root||!isDesignRootInSession(store.get().root,cwd)))sync.setRoot(cwd).catch(cause=>setError(cause.message));},[cwd,s.root]);
    const quote=async({auto=false,focus=false,withPreview}={})=>{
      if(store.get().workspaceMode==='motion'){
       // 动画工作台：附 motion 工程引用（对话即界面，AI 凭 projectId 定位工程）。
       if(!store.get().motion?.projectId)return;
       if(!auto){setBusy(true);setError(null);}
       try{
        const result=await attachDesignReference({store,sync,services:store.get().services,sessionId,auto,isCurrent:()=>store.get().workspaceMode==='motion'});
        if(result.attached){setQuoted(result.context);setError(null);if(focus)document.querySelector('.dcChat [contenteditable="true"]')?.focus();}
       }catch(cause){if(!auto)setError(cause.message);}
       finally{if(!auto)setBusy(false);}
       return;
      }
      if(store.get().workspaceMode!=='legacy'){
       if(!nativeController.context()||auto&&composing.current)return;
       if(!auto){setBusy(true);setError(null);}
       try{await quoteNative({controller:nativeController,services:store.get().services,sessionId,auto,liveSelection:!nativeController.state.advancedEditing,isCurrent:()=>store.get().workspaceMode!=='legacy'&&!composing.current});if(focus)document.querySelector('.dcChat [contenteditable="true"]')?.focus();}catch(cause){if(!auto||cause.message.includes('无法确认消息发送状态'))setError(cause.message);}finally{if(!auto)setBusy(false);}return;
      }
      if(!sessionId||!store.get().doc)return;const ticket=++sequence.current;
      if(!auto){setBusy(true);setError(null);}
      try{
        const result=await attachDesignReference({store,sync,services:store.get().services,sessionId,auto,prepareRegion:actions.prepareRegionReference,preview:!auto&&(withPreview??includePreview)?previewForChat:undefined,isCurrent:()=>ticket===sequence.current});
        if(ticket===sequence.current&&result.attached){setQuoted(result.context);setError(null);if(focus)document.querySelector('.dcChat [contenteditable="true"]')?.focus();}
      }catch(cause){if(ticket===sequence.current&&!auto)setError(cause.message);}
      finally{if(ticket===sequence.current)setBusy(false);}
    };
    useEffect(()=>{quote({auto:true});return()=>{sequence.current++;};},[sessionId,s.root,s.doc?.id,s.ui.pageId,s.ui.selectedId,s.ui.selectedIds,s.ui.nativeSelection,s.uiSelection,s.native?.sourceId,s.native?.sourceRevision,s.native?.epoch,s.native?.document?.uid,s.native?.document?.revision,s.native?.document?.selection?.join?.(','),s.native?.document?.selectionStamp,!!s.native?.busy,JSON.stringify(s.native?.document?.page),s.native?.advancedEditing,compositionRevision,s.workspaceMode,s.motion?.projectId,s.motion?.revision]);
    useEffect(()=>{
      if(!sessionId||s.workspaceMode==='legacy')return;
      const services=store.get().services,owner=services.sessions?.binding?.(sessionId),input=owner&&services.conversation?.input?.for?.(owner.ctx);
      if(!input?.state?.subscribe)return;
      // A regular DSH send is detached from the editable composer. Resume live
      // selection only after its actual serialization/Host admission completes,
      // including the SDK's synchronous failed-draft restoration.
      return input.state.subscribe(()=>{
        try{if(!nativeInputAdmissionLocked(input)&&!composing.current)quote({auto:true});}
        catch(cause){setError(cause.message);}
      });
    },[sessionId,s.workspaceMode]);
    useEffect(()=>{if(s.ui.chatFocus)quote({focus:true});},[s.ui.chatFocus]);
    const context=designChatContext(s),outside=!isActiveDesignSession(s.services,sessionId)||!!(s.root&&cwd&&!isDesignRootInSession(s.root,cwd));
    const phase=!sessionId?'hero':session?.openState==='loading'?'settling':'active';
    const sendFromConversation=async event=>{
      if(store.get().workspaceMode==='legacy')return;
      if(!isActiveDesignSession(store.get().services,sessionId)){event.preventDefault();event.stopPropagation();setError('项目设计对话已切换，未发送');return;}
      if(!nativeController.context())return;
      if(event.type==='keydown'){
        if(event.key!=='Enter'||event.shiftKey||event.isComposing||event.nativeEvent?.isComposing||!event.target?.closest?.('[contenteditable=true]'))return;
        const {input}=currentNativeInput(store.get().services,sessionId);
        if(input.state.getSnapshot().phase==='claimed'||document.querySelector('[role=listbox]'))return;
      }else{
        const button=event.target?.closest?.('button'),label=button?.getAttribute('aria-label');
        if(!button||!['发送消息','Send message'].includes(label))return;
      }
      event.preventDefault();event.stopPropagation();setError(null);setBusy(true);
      try{await submitNativePrompt({controller:nativeController,services:store.get().services,sessionId,isCurrent:()=>store.get().workspaceMode!=='legacy'&&!composing.current});}
      catch(cause){setError(cause.message);}finally{setBusy(false);}
    };
    const openReference=event=>{
      const chip=event.target?.closest?.('[data-composer-chip],[data-composer-text-ref]');if(!chip||['designcraft','designcraft-editor'].includes(chip.getAttribute('data-composer-chip')))return;
      const editor=chip.closest('[contenteditable="true"]');if(!editor)return;
      event.preventDefault();event.stopPropagation();
      const owner=s.services?.sessions?.binding?.(sessionId),input=s.services?.conversation?.input?.for?.(owner.ctx);
      const source=chip.getAttribute('data-composer-chip');
      let reference;if(source){const chips=[...editor.querySelectorAll('[data-composer-chip]')],refs=input?.draftSnapshot?.references||[];if(chips.length===refs.length)reference=refs[chips.indexOf(chip)];}
      else reference={ref:chip.textContent};
      if(!reference){actions.toast('请在 DSH 原对话中打开此引用');return;}
      return openNativeChatReference({store,sync,sessionId,reference});
    };
    const target=s.workspaceMode==='motion'
      ?s.motion?.projectId?[s.motion.title||'动画',s.motion.selection?.ids?.length?'已选 '+s.motion.selection.ids.length+' 个组件':null].filter(Boolean).join(' · '):null
      :s.native?.document?aiCanvasTarget(s.native.document):null;
    return h('div',{className:'dcChatConversation',onClickCapture:event=>{openReference(event);return sendFromConversation(event);},onKeyDownCapture:sendFromConversation,onCompositionStartCapture:()=>{composing.current=true;},onCompositionEndCapture:()=>{composing.current=false;setCompositionRevision(value=>value+1);}},
      h('div',{className:'dcStudioContext'},
        s.workspaceMode!=='legacy'?h(React.Fragment,null,
         target?h('div',{className:'dcStudioTarget',title:target},h(StudioIcon,{name:'ai',size:13}),h('span',null,target)):null,
         s.native?.advancedEditing&&s.workspaceMode==='native'&&s.native?.document?h(StudioButton,{icon:'ai',disabled:s.native.busy||busy,onClick:()=>quote({focus:true})},busy?'正在准备引用…':'引用当前选择'):null,
         session?.running?h(StudioStatus,{kind:'busy'},'AI 正在处理'):null):!sessionId?h('p',{className:'dcHint'},'先选择 DSH 项目，然后直接在下方描述设计需求。'):!s.doc?h('p',{className:'dcHint'},'直接告诉 AI 想做什么，新作品会显示在右侧画布。'):h('div',null,
          h('div',{className:'dcChatReferences'},h('span',{className:'dcChatReference',title:context.title},context.title),context.layerId?h('span',{className:'dcChatReference'},'选中：'+context.layerName):null),
          h('div',{className:'dcRow'},h('button',{className:'dcBtn',disabled:busy||outside,onClick:()=>quote({focus:true})},busy?'正在准备引用…':context.layerId?'引用选中对象':'引用当前画板'),h('label',{className:'dcHint',style:{display:'flex',alignItems:'center',gap:4}},h('input',{type:'checkbox',checked:includePreview,onChange:event=>{setIncludePreview(event.target.checked);return quote({withPreview:event.target.checked});}}),'附预览快照')),
          h('p',{className:'dcHint',style:{margin:0}},quoted?'引用会显示在下方输入框中，可随消息发送或自行移除。':'选中对象后，点“让 AI 修改”，再在下方描述要求。')),
        outside?h('div',{className:'dcChatError',role:'alert'},'此画布与当前对话不属于同一项目，请先在 DSH 侧栏切换项目。'):null,
        error?h('div',{className:'dcChatError',role:'alert'},userFacingError(error,'暂时无法发送设计要求，请重试。')):null),
      outside?h('div',{className:'dcChatWelcome'},h('p',null,'当前画布尚未切换到此对话的项目。请先保存或处理冲突，再继续设计。'),h('button',{className:'dcBtn',onClick:()=>sync.setRoot(cwd)},'保存并切换到当前项目')):props.renderFactorySlot('conversation.content',{variant:'embedded',phase,hero:!sessionId}));
  }

  function ChatDock({renderConversation,onClose}){
    const s=useStore(),assistant=s.services.designAssistant,state=s.designAssistant,scope=assistant?.scope();
    useEffect(()=>assistant?.start(),[assistant]);
    return h('aside',{className:'dcChat',id:'urania-design-chat','aria-label':'设计 AI 对话'},h('div',{className:'dcChatHead'},
      h('span',{className:'dcStudioAiBadge'},h(StudioIcon,{name:'ai',size:16})),h('strong',null,'设计助手'),
      onClose?h(StudioButton,{icon:'panel',label:'收起设计对话',className:'dcStudioChatClose',onClick:onClose}):null),
      scope&&state?.reference&&renderConversation?renderConversation(state.reference):h('div',{className:'dcChatWelcome',role:state?.error?'alert':'status'},h('p',null,state?.error||(!state||state.phase==='idle'?'请先在 DSH 选择一个项目，设计助手会打开该项目独立的设计对话。':'正在打开项目设计对话…')),state?.error?h('button',{className:'dcBtn',onClick:()=>assistant.retry()},'重试设计对话'):null));
  }

	/* ---------------- status bar ---------------- */

	function HistoryDrawer() {
		const s=useStore(),[entries,setEntries]=useState([]),[error,setError]=useState(null),[busy,setBusy]=useState(false);
		useEffect(()=>{let alive=true;sync.history().then(body=>{if(alive)setEntries(body.history||[]);}).catch(e=>{if(alive)setError(e.message);});return()=>{alive=false;};},[s.activeId,s.revision]);
		return h('div',null,
			h('p',{className:'dcHint'},'恢复会保留当前版本。服务器保留最近 50 个版本，单作品历史最多 128MB。'),
			error?h('p',null,error):null,
			!entries.length?h('p',{className:'dcHint'},'暂无历史版本'):null,
			entries.map(entry=>h('div',{key:entry.revision,className:'dcCard'},
				h('p',null,new Date(entry.at).toLocaleString()),
				h('button',{className:'dcBtn',disabled:busy,onClick:async()=>{setBusy(true);try{await sync.restore(entry.revision);actions.toast('历史版本已恢复，恢复前的版本仍保留。');}catch(e){actions.toast(e.message);}finally{setBusy(false);}}},'恢复此版本'))));
	}

	function SyncNotice() {
		const s=useStore(),[busy,setBusy]=useState(false);
		const run=fn=>async()=>{setBusy(true);try{await fn();}catch(e){actions.toast(e.message);}finally{setBusy(false);}};
		const style={padding:'9px 14px',display:'flex',gap:8,alignItems:'center',flexWrap:'wrap',background:'rgba(180,72,70,.12)',color:'var(--dc-ink)',borderBottom:'1px solid var(--dc-line)',fontSize:12};
		if(s.conflict)return h('div',{style,role:'alert'},
			h('span',{style:{flex:1}},'存在同时编辑的冲突，本地内容尚未覆盖远端。'),
			h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>sync.saveLocalCopy())},'另存本地副本'),
			h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>sync.useRemoteVersion())},'采用远端并保留本地副本'));
		if(s.remoteDeleted)return h('div',{style,role:'alert'},h('span',{style:{flex:1}},'远端作品已删除，当前画布仍保留。'),h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>sync.saveLocalCopy())},'另存当前内容'));
		if(s.saveError)return h('div',{style,role:'alert'},h('span',{style:{flex:1}},'尚未保存：'+s.saveError),h('button',{className:'dcBtn',disabled:busy,onClick:run(()=>sync.flush())},'重试保存'));
		if(s.stateError)return h('div',{style,role:'alert'},s.stateError);
		if(s.recoveryNotice)return h('div',{style:{...style,background:'rgba(40,125,108,.12)'},role:'status'},h('span',{style:{flex:1}},s.recoveryNotice),h('button',{className:'dcBtn',onClick:()=>store.set({recoveryNotice:null})},'知道了'));
		if(s.recoveryError&&s.dirty)return h('div',{style,role:'alert'},'本地恢复副本写入失败，请保持窗口打开并完成保存：'+s.recoveryError);
		return null;
	}

	function StatusBar() {
		const s = useStore();
		const pt = s.ui.pointer;
		const activeJob=(s.jobs||[]).find(job=>['queued','running'].includes(job.status));
		return h('div', { className: 'dcStatusBar' },
			h('span', null, Math.round(s.ui.zoom * 100) + '%'),
			h('span', null, pt ? `x ${Math.round(pt.x)} · y ${Math.round(pt.y)}` : ''),
			s.doc ? h('span', null, s.doc.title + ' · ' + (s.doc.type === 'deck' ? '演示文稿' : s.doc.type === 'photo' ? '图片' : '画板') + ' · ' + (s.doc.pages?.length || 0) + ' 页') : null,
			activeJob?h('span',null,activeJob.status==='queued'?'后台任务排队中':'后台处理中',activeJob.progress?'（第'+(activeJob.progress.index+1)+'项，共'+activeJob.progress.total+'项）':''):null,
			activeJob?h('button',{className:'dcBtn',onClick:()=>sync.cancelJob(activeJob.id)},'取消任务'):null,
			h('span', { style: { marginLeft: 'auto' } }, 'V 移动 · A 节点 · T 文字 · S 形状 · P 钢笔 · B 画笔 · M 选框 · H 抓手 · Ctrl+Z 撤销 · 滚轮平移 · Ctrl+滚轮缩放')
		);
	}

	/* ---------------- landing ---------------- */

	function Landing() {
		const s = useStore();
		const [busy, setBusy] = useState(false);
		return h('div', { className: 'dcLanding' },
			h('div', { className: 'dcLandingCard' },
				h('h2', null, 'DesignCraft 设计工作区'),
				h('p', null, '在一个项目中编辑图像、路径、版式和演示文稿，使用 DSH 会话协同创作。'),
				h('div', { style: { display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' } },
					h('button', { className: 'dcBtn dcPrimary', disabled: busy || !s.sessionCwd, onClick: async () => { setBusy(true); try { await sync.setRoot(s.sessionCwd); } catch(error) { actions.toast(error.message); } finally { setBusy(false); } } }, h(Icon, { name: 'folder', size: 14 }), '打开当前会话目录'),
					h('button', { className: 'dcBtn', disabled: busy, onClick: async () => {
						try {
							const svc = store.get().services?.uiWorkspace;
							if (!svc?.pickDirectory) { actions.toast('目录选择器不可用，请先在会话中打开工作区'); return; }
							const dir = await svc.pickDirectory();
							if (dir){
                                await sync.flush();
                                if(svc.workspaces?.create&&svc.openWorkspace){const workspace=await svc.workspaces.create({path:dir});await svc.openWorkspace(workspace.workspaceId);svc.ctx?.get?.('layout')?.selectPanel('designcraft');}
                                else await sync.setRoot(dir);
                            }
						} catch (error) { actions.toast(String(error)); }
					} }, '选择目录…')),
				s.stateError ? h('p', { style: { color: '#B44846', fontSize: 12 } }, s.stateError) : null)
		);
	}

	/* ---------------- root app ---------------- */

	function App({renderConversation}) {
		const s = useStore();
    const studioRoot=useRef(null);
    const [chatOpen,setChatOpen]=useState(()=>{try{return localStorage.getItem('urania-studio-chat-open')!=='0';}catch{return true;}});
    const [fullScreen,setFullScreen]=useState(false);
    const changeChat=(open,{focus=false}={})=>{
      setChatOpen(open);
      try{localStorage.setItem('urania-studio-chat-open',open?'1':'0');}catch{}
      if(focus)requestAnimationFrame(()=>{
        if(open)studioRoot.current?.querySelector('.dcChat [contenteditable=true]')?.focus();
        else studioRoot.current?.querySelector('[data-chat-toggle]')?.focus();
      });
    };
    useEffect(()=>{
      const update=()=>setFullScreen(!!document.fullscreenElement);
      document.addEventListener('fullscreenchange',update);
      return ()=>document.removeEventListener('fullscreenchange',update);
    },[]);
    const fullscreen=async()=>{
      if(document.fullscreenElement){await document.exitFullscreen();return;}
      const root=studioRoot.current,portal=nativeController.portal;
      const target=portal&&nativeController.surface&&!root?.contains(portal)?document.documentElement:root;
      if(target?.requestFullscreen)await target.requestFullscreen();
    };
		injectStyles();
        useEffect(()=>{if(store.get().workspaceMode!=='legacy'&&s.dirty&&s.doc&&!nativeController.state.sourceId)store.set({workspaceMode:'legacy'});},[s.dirty,s.doc?.id]);
		useEffect(() => {
			const onKey=e=>{try{const result=controller.onKeyDown(e);result?.catch?.(error=>actions.toast(error.message));}catch(error){actions.toast(error.message);}};
			const beforeUnload = e => {if(store.get().dirty||store.get().native?.dirty||store.get().native?.saving||store.get().native?.htmlDirty||store.get().native?.htmlDraftPending||store.get().native?.htmlDraftError||store.get().native?.htmlEmergency){e.preventDefault();e.returnValue='';}};
			window.addEventListener('keydown', onKey);
			window.addEventListener('beforeunload',beforeUnload);
			return () => {window.removeEventListener('keydown', onKey);window.removeEventListener('beforeunload',beforeUnload);};
		}, []);
		if(s.workspaceMode!=='legacy'){
      const motion=s.workspaceMode==='motion';
      return h('div',{className:'dcApp',ref:studioRoot,'data-studio':'','data-ui-build':s.uiBuild||166,'data-editor-mode':motion?'motion':'native'},
        h('header',{className:'dcStudioTop','aria-label':'Urania 工作台导航'},
          h('div',{className:'dcStudioBrand'},h('span',{className:'dcStudioBrandMark'},h(StudioIcon,{name:'brand',size:18})),'Urania'),
          h('nav',{className:'dcStudioModes','aria-label':'工作区'},
            h(StudioButton,{icon:'design','aria-pressed':!motion,onClick:()=>store.set({workspaceMode:'native'})},'设计'),
            h(StudioButton,{icon:'motion','aria-pressed':motion,onClick:()=>store.set({workspaceMode:'motion'})},'动画')),
          h('div',{className:'dcStudioUtilities'},
            h(StudioButton,{icon:'panel',label:chatOpen?'收起 AI 对话':'打开 AI 对话','data-chat-toggle':'','aria-controls':'urania-design-chat','aria-expanded':chatOpen,onClick:()=>changeChat(!chatOpen,{focus:true})}),
            document.fullscreenEnabled?h(StudioButton,{icon:'focus',label:fullScreen?'退出全屏':'全屏工作区','aria-pressed':fullScreen,onClick:fullscreen}):null)),
        h('div',{className:'dcBody dcStudioBody'},h(ChatSplit,{open:chatOpen},h(ChatDock,{renderConversation,onClose:()=>changeChat(false,{focus:true})})),
          h('main',{className:'dcStudioMain'},motion?h(MotionWorkspace,{onFocusChat:()=>{
            changeChat(true,{focus:true});
            store.set({ui:{...store.get().ui,chatFocus:(store.get().ui.chatFocus||0)+1}});
          }}):h(NativeWorkspace,{onFocusChat:()=>changeChat(true,{focus:true})}))),
        h(Toast,{message:s.toast?userFacingError(s.toast):null}));
    }
		return h('div', { className: 'dcApp','data-ui-build':s.uiBuild||16 },
			h('button',{className:'dcBtn',onClick:()=>store.set({workspaceMode:'native'})},'返回设计工作区'),
			s.root?h(TopBar):null,
			h(SyncNotice),
			h('div', { className: 'dcBody' },
				s.ui.chatOpen!==false?h(ChatDock,{renderConversation}):null,
				s.root?h(ToolRail):null,
				h('div', { className: 'dcCenter' },
					s.root&&(s.doc?.type==='deck'||s.doc?.pages?.length>1)?h(PageRail):s.root&&s.doc?h('div',{className:'dcWorkLabel'},s.doc.title,h('span',{className:'dcHint'},s.doc.canvas.width+' × '+s.doc.canvas.height)):null,
					s.root&&s.doc?.native?.mediaLink?h('div',{className:'dcRow',style:{padding:6,borderBottom:'1px solid var(--dc-line)'}},h('span',{className:'dcHint'},'演示关联源 · 裁剪、布局与原生调色在演示中保留'),h('button',{className:'dcBtn dcPrimary',disabled:!!s.mediaBusy||s.nativeBusy,onClick:()=>actions.commitLinkedMedia()},s.mediaBusy?'正在应用…':'应用图片并返回演示'),s.doc.native.mediaLink.editor==='vector'?h('button',{className:'dcBtn',disabled:!!s.mediaBusy||s.nativeBusy,onClick:()=>actions.commitLinkedMedia({raster:true})},'以位图应用并返回'):null):null,
					s.root?h('div',{style:{height:76,minHeight:76,overflow:'auto'}},h(SelectionTools)):null,
					s.root?h('div',{style:{flex:1,display:'flex',position:'relative',minHeight:0}},h(CanvasHost),s.ui.selectedId&&['select','direct'].includes(s.ui.tool)&&!s.ui.editingTextId?h('div',{className:'dcSelectionBar'},h('span',null,designChatContext(s).layerName||'选中对象'),h('button',{className:'dcBtn dcPrimary',onClick:()=>store.set({ui:{...store.get().ui,chatOpen:true,chatFocus:(store.get().ui.chatFocus||0)+1}})},'让 AI 修改'),h('button',{className:'dcBtn',onClick:()=>store.set({ui:{...store.get().ui,inspectorOpen:true}})},'编辑属性')):null):h(Landing),
					s.root?h(StatusBar):null),
				s.root&&s.ui.inspectorOpen?h('div', { className: 'dcRight' },
					h(LayersPanel),
					h('div', { style: { borderTop: '1px solid var(--dc-line)', flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } }, h(ToolOptions),h(Inspector))):null),
			s.ui.drawer ? h(Drawer, { kind: s.ui.drawer, onClose: () => store.set({ ui: { ...store.get().ui, drawer: null } }) }) : null,
			h(Toast, { message: s.toast })
		);
	}

	return { App,DesignConversation,nativeController };
}
