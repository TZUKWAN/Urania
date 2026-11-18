// Local line icons for the Urania workbench. All paths share a 24 px grid.
const icons = {
  brand: 'M12 2.5v19M2.5 12h19M5.3 5.3l13.4 13.4M18.7 5.3 5.3 18.7M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 1 0 0-11',
  ai: 'M12 2.5 14.6 9.4 21.5 12l-6.9 2.6L12 21.5l-2.6-6.9L2.5 12l6.9-2.6L12 2.5Z',
  design: 'M4 4h16v16H4zM8 4v16M8 16h12',
  vector: 'm4 20 3-9L17 3l4 4-8 10-9 3Zm0 0 7-7m2-2a1.4 1.4 0 1 0 0 2.8A1.4 1.4 0 0 0 13 11Z',
  photo: 'M4 5h16v14H4zM4 16l4-4 4 4 3-3 5 4M15 8h.01',
  deck: 'M3 4h18v12H3zM12 16v5m-5 0h10M7 8h4m-4 4h8',
  motion: 'M3 5h18v14H3zM7 5v14M17 5v14M3 10h4m10 0h4M3 15h4m10 0h4m-7-3 3 2-3 2z',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  assets: 'm12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5',
  plus: 'M12 5v14M5 12h14',
  subtract: 'M5 12h14',
  upload: 'M12 16V4m-5 5 5-5 5 5M4 16v4h16v-4',
  download: 'M12 4v12m-5-5 5 5 5-5M4 17v3h16v-3',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  chevron: 'm7 9 5 5 5-5',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  close: 'm6 6 12 12M18 6 6 18',
  panel: 'M3 4h18v16H3zM9 4v16m5-11 3 3-3 3',
  focus: 'M8 4H4v4m12-4h4v4m0 8v4h-4M4 16v4h4',
  settings: 'M4 7h16M4 12h16M4 17h16M8 5v4m8 1v4m-7 1v4',
  history: 'M5 6a8 8 0 1 1-1 11M3 5v5h5m4-3v5l3 2',
  undo: 'M9 5 4 10l5 5m-5-5h10a5 5 0 0 1 5 5v2',
  redo: 'm15 5 5 5-5 5m5-5H10a5 5 0 0 0-5 5v2',
  search: 'M10 4a6 6 0 1 0 0 12 6 6 0 1 0 0-12Zm4.3 10.3L20 20',
  check: 'm5 12 4 4L19 6',
  warning: 'M12 4 22 20H2L12 4Zm0 6v4m0 3h.01',
  play: 'm9 5 11 7-11 7z',
  pause: 'M9 5v14m6-14v14',
  start: 'M5 6v12m12-12-8 6 8 6z',
  end: 'M19 6v12M7 6l8 6-8 6z',
  film: 'M3 5h18v14H3zM3 9h18M3 15h18M8 5v4m8-4v4M8 15v4m8-4v4',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18Zm0 4v5l3 2',
};

export const studioEngines = [
  { id:'vectorcraft', icon:'vector', title:'矢量画板', detail:'海报、标志与插画' },
  { id:'photocraft', icon:'photo', title:'图片编辑', detail:'图层、蒙版与局部调整' },
  { id:'deckcraft', icon:'deck', title:'演示文稿', detail:'多页幻灯片与可编辑 PPTX' },
  { id:'motion', icon:'motion', title:'代码动画', detail:'编排时间轴并导出视频' },
];

export function createStudioComponents(React) {
  const h = React.createElement;
  function Icon({ name, size = 17 }) {
    return h('svg', {
      width:size, height:size, viewBox:'0 0 24 24', fill:'none',
      stroke:'currentColor', strokeWidth:name==='brand'?1.35:1.65,
      strokeLinecap:'round', strokeLinejoin:'round', 'aria-hidden':true,
    }, h('path', { d:icons[name] || icons.design }));
  }
  function Button({ icon, children, label, className = '', ...props }) {
    return h('button', {
      type:'button', className:'dcBtn '+(children?'':'dcIcon ')+className,
      ...(label?{'aria-label':label,title:label}:{}), ...props,
    }, icon?h(Icon,{name:icon}):null, children);
  }
  function Status({ children, kind = 'neutral', icon }) {
    return h('span',{className:'dcStudioStatus','data-kind':kind,role:'status'},
      icon?h(Icon,{name:icon,size:14}):h('i',{'aria-hidden':true}),children);
  }
  return { Icon, Button, Status };
}

export function userFacingError(error, fallback = '操作未完成，请稍后重试。') {
  const value = String(error?.message || error || '').trim();
  if (!value) return fallback;
  if (/(?:Failed to fetch|net::|NetworkError|ECONNRESET|ETIMEDOUT)/i.test(value)) return '暂时无法连接服务，请检查网络后重试。';
  if (/[{[]["{[]|(?:\n\s*at\s)|(?:TypeError|SyntaxError|ReferenceError):/.test(value) || value.length>500) return fallback;
  return value.replace(/^E_[A-Z_]+:\s*/, '');
}

export function mountStudioStyles() {
  if (document.querySelector('style[data-urania-studio]')) return;
  const style = document.createElement('style');
  style.dataset.uraniaStudio = '';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.dcApp[data-studio] {
  --dc-bg:#f0eeeb; --dc-surface:#fcfbf9; --dc-raised:#fffefd; --dc-soft:#ece9e6;
  --dc-ink:#24232a; --dc-secondary:#494750; --dc-muted:#65616d; --dc-line:#e3dfdc;
  --dc-accent:#5847a1; --dc-accent2:#8170c7; --dc-tint:#eeebfa; --dc-on-accent:#fff;
  --dc-success:#307245; --dc-warning:#855d18; --dc-danger:#a23643; --dc-scrim:rgba(40,33,47,.19);
  --dc-s1:4px; --dc-s2:8px; --dc-s3:12px; --dc-s4:16px; --dc-s6:24px; --dc-s8:32px;
  --dc-radius:8px; --dc-card-radius:14px; --dc-float-radius:18px;
  --dc-float-shadow:0 3px 8px rgba(35,28,42,.05),0 18px 52px rgba(35,28,42,.13);
  --dc-ui-font:"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","PingFang SC",sans-serif;
  --dc-mono:ui-monospace,"Cascadia Mono","SFMono-Regular",monospace;
  --dc-fast:135ms; --dc-menu:180ms; --dc-panel:245ms; --dc-page:290ms;
  --dc-ease:cubic-bezier(.2,.8,.2,1); --dc-exit:cubic-bezier(.4,0,1,1);
  position:relative; isolation:isolate; container-type:inline-size; overflow:hidden;
  font:13px/1.6 var(--dc-ui-font); letter-spacing:.002em;
}
body[data-ds-dark-theme] .dcApp[data-studio] {
  --dc-bg:#201f24; --dc-surface:#29282e; --dc-raised:#313038; --dc-soft:#35333e;
  --dc-ink:#f0edf3; --dc-secondary:#d2cdd9; --dc-muted:#b0aab9; --dc-line:#433f49;
  --dc-accent:#baaef7; --dc-accent2:#b2a3f2; --dc-tint:#403751; --dc-on-accent:#232031;
  --dc-success:#9fd6aa; --dc-warning:#ebca8b; --dc-danger:#ffadba; --dc-scrim:#14121877;
  --dc-float-shadow:0 3px 9px #0d0a1466,0 22px 54px #0e0b1766;
}
.dcApp[data-studio] :is(button,select,input,textarea,summary,[tabindex]):focus-visible {
  outline:2px solid var(--dc-accent2); outline-offset:2px;
}
.dcApp[data-studio] :is(button,input,textarea,select) { font-family:var(--dc-ui-font); }
.dcApp[data-studio] [hidden] { display:none!important; }
.dcApp[data-studio] .dcBtn {
  height:34px; gap:7px; padding:0 11px; border:1px solid transparent; border-radius:var(--dc-radius);
  background:transparent; color:var(--dc-secondary); font-size:12px; line-height:1; font-weight:560;
  transition:background-color var(--dc-fast),border-color var(--dc-fast),color var(--dc-fast),transform var(--dc-fast) var(--dc-ease);
}
.dcApp[data-studio] .dcBtn:hover:not(:disabled) { background:var(--dc-soft); color:var(--dc-ink); }
.dcApp[data-studio] .dcBtn:active:not(:disabled) { transform:scale(.98); }
.dcApp[data-studio] .dcBtn.dcPrimary { background:var(--dc-accent);color:var(--dc-on-accent);font-weight:620; }
.dcApp[data-studio] .dcBtn.dcPrimary:hover:not(:disabled) { background:color-mix(in srgb,var(--dc-accent) 91%,var(--dc-ink));color:var(--dc-on-accent); }
.dcApp[data-studio] .dcBtn.dcIcon { width:34px;padding:0; }
.dcApp[data-studio] .dcBtn:disabled { opacity:.46; }
.dcApp[data-studio] .dcBtn:is([aria-expanded=true],[aria-pressed=true],.dcActive) { background:var(--dc-tint);color:var(--dc-accent); }
.dcApp[data-studio] :is(.dcInput,.dcSelect,.dcTextarea) {
  min-height:34px;border:1px solid var(--dc-line);border-radius:var(--dc-radius);
  background:var(--dc-raised);color:var(--dc-ink);font-family:var(--dc-ui-font);
}
.dcStudioTop {
  display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;
  min-height:49px;gap:12px;padding:0 15px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);flex:none;
}
.dcStudioBrand { display:flex;align-items:center;gap:8px;color:var(--dc-ink);width:max-content;font-size:16px;font-weight:680;letter-spacing:-.035em; }
.dcStudioBrandMark { width:28px;height:28px;border-radius:9px;background:var(--dc-accent);color:var(--dc-on-accent);display:grid;place-items:center; }
.dcStudioModes { display:flex;align-items:center;gap:2px;padding:3px;border-radius:10px;background:var(--dc-soft); }
.dcApp[data-studio] .dcStudioModes .dcBtn { height:28px; }
.dcApp[data-studio] .dcStudioModes .dcBtn[aria-pressed=true] { background:var(--dc-raised);color:var(--dc-ink);box-shadow:0 1px 3px #23203416; }
.dcStudioUtilities { display:flex;align-items:center;justify-content:flex-end;gap:4px; }
.dcStudioBody { position:relative;min-height:0;min-width:0;flex:1;display:flex;isolation:isolate; }
.dcStudioMain { flex:1;min-width:0;min-height:0;display:flex;container-type:inline-size; }
.dcStudioMain>.dcNativeWorkspace,.dcStudioMain>.dc-motion { flex:1;min-width:0;min-height:0; }
.dcApp[data-studio] .dcChatColumn { background:var(--dc-surface); }
.dcApp[data-studio] .dcChatColumn>.dcChat {
  width:100%;min-width:0;max-width:none;background:var(--dc-surface);border:none;
  padding:0;--dsh-conversation-column-width:var(--dc-chat-width);
}
.dcApp[data-studio] .dcChatHead { height:52px;padding:0 16px;gap:9px;border-bottom:0; }
.dcApp[data-studio] .dcChatHead strong { font-size:13.5px; }
.dcStudioAiBadge { width:27px;height:27px;display:grid;place-items:center;border-radius:9px;background:var(--dc-tint);color:var(--dc-accent); }
.dcStudioChatClose { margin-left:auto; }
.dcApp[data-studio] .dcChatConversation { background:var(--dc-surface); }
.dcStudioContext { padding:0 14px 8px;flex:none;min-width:0; }
.dcStudioTarget {
  display:flex;align-items:center;gap:8px;width:max-content;max-width:100%;padding:4px 8px;border-radius:7px;
  background:var(--dc-tint);color:var(--dc-accent);font-size:11.5px;font-weight:620;
}
.dcStudioTarget span { overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.dcStudioTarget small { font:inherit;color:var(--dc-muted); }
.dcStudioChatIntro { margin:auto;padding:20px 20px 12px;color:var(--dc-muted); }
.dcStudioChatIntro strong { display:block;color:var(--dc-ink);font-size:15px;margin-bottom:4px; }
.dcApp[data-studio] .dcChat :is([data-composer-chip],[data-composer-text-ref]) { animation:dcStudioReveal var(--dc-menu) var(--dc-ease) both; }
.dcApp[data-studio] .dcChatConversation [contenteditable=true] { font-size:13px;line-height:1.65; }
.dcApp[data-studio] .dcChat button:is([aria-label="发送消息"],[aria-label="Send message"]):not(:disabled) { background:var(--dc-accent);color:var(--dc-on-accent); }
.dcApp[data-studio] .dcChatSplit { background:var(--dc-surface);width:7px;flex:0 0 7px;z-index:2; }
.dcApp[data-studio] .dcChatSplit span { inset:0 3px;background:var(--dc-line); }
.dcApp[data-studio] .dcChatSplit:is(:hover,:focus-visible,[data-dragging=true]) span { inset:0 2px;background:var(--dc-accent2); }
.dcChatColumn[data-entering] { animation:dcStudioPanel var(--dc-panel) var(--dc-ease) both; }
.dcStudioStatus { display:inline-flex;align-items:center;gap:5px;color:var(--dc-muted);font-size:11.5px;white-space:nowrap; }
.dcStudioStatus i { width:6px;height:6px;border-radius:50%;background:currentColor;flex:none; }
.dcStudioStatus[data-kind=success] { color:var(--dc-success); }
.dcStudioStatus[data-kind=warning] { color:var(--dc-warning); }
.dcStudioStatus[data-kind=error] { color:var(--dc-danger); }
.dcStudioStatus[data-kind=busy] { color:var(--dc-accent); }
.dcApp[data-studio] .dcNativeHeader {
  height:49px;gap:4px;padding:0 12px;background:var(--dc-surface);min-width:0;position:relative;z-index:5;
}
.dcStudioFileActions { min-width:0;display:flex;align-items:center;gap:3px; }
.dcStudioFileActions [data-separator] { width:1px;height:18px;background:var(--dc-line);margin:0 3px; }
.dcApp[data-studio] .dcNativeTitle { flex:1;min-width:40px;margin:0 6px 0 3px;gap:1px; }
.dcApp[data-studio] .dcNativeTitle strong { font-size:13px;font-weight:665; }
.dcApp[data-studio] .dcNativeTitle small { color:var(--dc-muted);font-size:11px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.dcApp[data-studio] .dcNativeStage { background:var(--dc-bg);overflow:hidden;isolation:isolate; }
.dcApp[data-studio] .dcNativeEmpty {
  overflow:auto;align-items:safe center;justify-content:center;z-index:2;padding:28px;
  background:radial-gradient(ellipse at 62% 30%,color-mix(in srgb,var(--dc-raised) 85%,transparent),transparent 67%),var(--dc-bg);
}
.dcStudioHome { width:min(100%,610px);padding:10px 0 20px;animation:dcStudioReveal var(--dc-page) var(--dc-ease) both; }
.dcStudioHomeHero { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:16px;align-items:center;margin-bottom:26px; }
.dcStudioHome h1 { font-size:clamp(27px,5cqi,43px);letter-spacing:-.055em;line-height:1.14;margin:0;color:var(--dc-ink);font-weight:680;text-wrap:balance; }
.dcStudioHome p { margin:10px 0 0;color:var(--dc-muted);line-height:1.7;font-size:13px; }
.dcStudioOrbit { width:108px;height:108px;color:var(--dc-accent);opacity:.82; }
.dcStudioCreateGrid { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px; }
.dcStudioStart {
  display:grid;grid-template-columns:37px minmax(0,1fr) 16px;align-items:center;gap:11px;
  min-height:69px;padding:10px 12px;border:1px solid var(--dc-line);border-radius:var(--dc-card-radius);
  background:var(--dc-surface);color:var(--dc-ink);text-align:left;cursor:pointer;
  transition:background-color var(--dc-fast),border-color var(--dc-fast),box-shadow var(--dc-menu),transform var(--dc-fast) var(--dc-ease);
}
.dcStudioStart>span:nth-child(2) { display:grid;gap:2px; }
.dcStudioStart strong { font-size:13px;font-weight:660; }
.dcStudioStart small { color:var(--dc-muted);font-size:11.5px;line-height:1.35; }
.dcStudioStart>svg { color:var(--dc-muted); }
.dcStudioStart:hover:not(:disabled) { border-color:var(--dc-accent2);box-shadow:0 6px 12px #2b214d10;transform:translateY(-1px); }
.dcStudioStart:active:not(:disabled) { transform:translateY(1px); }
.dcStudioStart:disabled { opacity:.53;cursor:default; }
.dcStudioEngineIcon { width:34px;height:34px;display:grid;place-items:center;border-radius:9px;background:var(--dc-tint);color:var(--dc-accent); }
.dcStudioEngineIcon[data-engine=photocraft] { background:#e9eee7;color:#406454; }
.dcStudioEngineIcon[data-engine=deckcraft] { background:#f2e9de;color:#875b31; }
.dcStudioEngineIcon[data-engine=motion] { background:#e6edf2;color:#405d83; }
body[data-ds-dark-theme] .dcStudioEngineIcon[data-engine=photocraft] { background:#34453d;color:#aeccba; }
body[data-ds-dark-theme] .dcStudioEngineIcon[data-engine=deckcraft] { background:#4a3d35;color:#efc4a1; }
body[data-ds-dark-theme] .dcStudioEngineIcon[data-engine=motion] { background:#364151;color:#a8c5f0; }
.dcStudioHomeLinks { display:flex;gap:6px;flex-wrap:wrap;margin-top:15px;align-items:center; }
.dcApp[data-studio] .dcAiCanvasTools {
  min-height:41px;gap:7px;padding:4px 12px;background:var(--dc-surface);border-color:var(--dc-line);
}
.dcApp[data-studio] .dcAiCanvasTarget { flex-wrap:nowrap;gap:8px; }
.dcApp[data-studio] .dcAiCanvasTarget small { white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.dcApp[data-studio] .dcAiCanvasTools .dcBtn { height:30px; }
.dcApp[data-studio] .dcFeedbackPanel { padding:2px 14px 4px;max-height:185px; }
.dcApp[data-studio] .dcFeedbackPanel summary { padding:3px 0; }
.dcApp[data-studio] .dcNativeNotice {
  padding:7px 12px;max-height:108px;overflow:auto;background:var(--dc-surface);
  color:var(--dc-secondary);font-size:12px;overflow-wrap:anywhere;
}
.dcApp[data-studio] .dcNativeNotice[role=alert] { background:color-mix(in srgb,var(--dc-danger) 8%,var(--dc-surface));color:var(--dc-danger); }
.dcApp[data-studio] .dcNativeNotice[data-kind=draft] { background:var(--dc-tint); }
.dcApp[data-studio] .dcSelectionAi {
  padding:12px;max-height:calc(100dvh - 16px);overflow:auto;border-radius:var(--dc-card-radius);
  background:var(--dc-raised);box-shadow:var(--dc-float-shadow);animation:dcStudioReveal var(--dc-menu) var(--dc-ease) both;
}
.dcApp[data-studio] .dcSelectionAi textarea {
  display:block;min-height:72px;border-radius:8px;font:13px/1.55 var(--dc-ui-font);background:var(--dc-surface);
}
.dcApp[data-studio] .dcSelectionAiHead strong { font-size:13px; }
.dcApp[data-studio] .dcSelectionAi[data-multiselect=true] { opacity:.48; }
.dcApp[data-studio] .dcSelectionAiFoot { gap:6px; }
.dcApp[data-studio] .dcSelectionAiFoot small { font-size:11px; }
.dcStudioDialogHeading { display:flex;align-items:center;gap:8px;margin:0 0 12px; }
.dcStudioDialogHeading strong { font-size:15px;flex:1;color:var(--dc-ink); }
.dcStudioDialogHeading small { color:var(--dc-muted); }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover {
  position:absolute;inset:56px 10px auto auto;z-index:12;display:block;
  width:min(350px,calc(100% - 20px));max-height:calc(100% - 66px);overflow:auto;
  padding:10px;margin:0;border:1px solid var(--dc-line);border-radius:var(--dc-card-radius);
  box-shadow:var(--dc-float-shadow);background:var(--dc-raised);transform-origin:top right;
  animation:dcStudioMenu var(--dc-menu) var(--dc-ease) both;overscroll-behavior:contain;
}
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover[data-menu=works] { left:10px;right:auto;width:min(650px,calc(100% - 20px));transform-origin:top left;padding:14px; }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover[data-menu=assets] { width:min(470px,calc(100% - 20px));padding:14px; }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover[data-menu=new] { width:min(465px,calc(100% - 20px));padding:16px; }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover[data-menu=review] { width:min(640px,calc(100% - 20px));padding:14px; }
.dcStudioReviewPair { display:grid;grid-template-columns:1fr 1fr;gap:10px; }
.dcStudioReviewPair figure { margin:0;min-width:0; }
.dcStudioReviewPair figcaption { color:var(--dc-muted);margin:0 0 5px;font-size:11.5px; }
.dcStudioReviewPair :is(.dcNativeThumbWrap,.dcNativeWorkThumb) { display:block;width:100%;height:clamp(100px,25vh,218px); }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover[data-menu] .dcNativeMenuItem {
  min-height:34px;border:0;width:100%;padding:8px 9px;border-radius:var(--dc-radius);margin:0;
  transition:background-color var(--dc-fast),color var(--dc-fast);
}
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover .dcNativeMenuDivider { height:1px;width:auto;margin:6px 4px; }
.dcApp[data-studio] .dcNativeWorkspace>.dcNativePopover .dcNativeSearch { max-width:none;padding:0 0 10px; }
.dcApp[data-studio] .dcNativePopover .dcNativeMenuEmpty { padding:24px 10px;text-align:center;width:100%; }
.dcApp[data-studio] .dcNativePopover[data-menu=works] .dcNativeWorksList { display:grid;grid-template-columns:repeat(3,minmax(0,1fr));max-height:min(390px,48vh);gap:9px;overflow:auto; }
.dcApp[data-studio] .dcNativePopover[data-menu=works] .dcNativeMenuItem { display:block;padding:8px;border:1px solid var(--dc-line);overflow:hidden; }
.dcApp[data-studio] .dcNativePopover[data-menu=works] .dcNativeMenuItem>span { display:block;white-space:nowrap;padding:2px 0; }
.dcApp[data-studio] .dcNativePopover[data-menu=works] :is(.dcNativeThumbWrap,.dcNativeWorkThumb) { width:100%;height:72px;display:block;object-fit:contain;padding:0; }
.dcApp[data-studio] .dcNativePopover[data-menu=works] .dcNativeThumbWrap small { white-space:normal; }
.dcApp[data-studio] .dcNativePopover[data-menu=assets] .dcNativeAsset { margin:7px 0;padding:10px; }
.dcApp[data-studio] .dcNativePopover[data-menu=assets] .dcNativeAssetActions { flex-wrap:wrap; }
.dcStudioUtilityRow { display:flex;gap:4px;flex-wrap:wrap;margin:0 0 8px; }
.dcStudioWorksFilter { display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px; }
.dcStudioWorkCard { position:relative;min-width:0; }
.dcStudioWorkCard>.dcIcon { position:absolute;top:11px;right:11px;background:var(--dc-raised)!important;opacity:0;transition:opacity var(--dc-fast); }
.dcStudioWorkCard:is(:hover,:focus-within)>.dcIcon { opacity:1; }
.dcStudioWorkHistory { display:grid;gap:6px; }
.dcStudioWorkHistory h3 { margin:3px 0;font-size:14px; }
.dcStudioWorkHistory :is(.dcNativeThumbWrap,.dcNativeWorkThumb) { height:124px!important; }
.dcStudioVersionRows { display:grid;max-height:170px;overflow:auto; }
.dcStudioLayers { max-height:185px;overflow:auto; }
.dcStudioLayers .dcNativeMenuItem { min-height:30px; }
.dcStudioInspectTitle { font-weight:630;overflow-wrap:anywhere; }
.dcStudioViewportControls {
  display:flex;gap:2px;padding:3px;position:absolute;z-index:5;right:19px;bottom:19px;
  border:1px solid var(--dc-line);border-radius:10px;background:var(--dc-raised);box-shadow:0 4px 18px #30253915;
}
.dcApp[data-studio] .dcStudioImageWorkspace { overflow:auto;animation:dcStudioReveal var(--dc-page) var(--dc-ease) both; }
.dcApp[data-studio] .dcStudioImageHeader { gap:8px;position:sticky;top:0;z-index:4; }
.dcApp[data-studio] .dcStudioImageHeader strong { flex:1;font-size:14px; }
.dcApp[data-studio] .dcStudioImageForm { padding:12px 16px;gap:8px; }
.dcApp[data-studio] .dcStudioImageForm textarea { min-width:min(240px,100%);min-height:70px;padding:8px 10px; }
.dcApp[data-studio] .dcStudioImageJob { border-radius:var(--dc-card-radius);background:var(--dc-raised); }
.dcApp[data-studio] .dcStudioImageJobs { flex:1;min-height:130px; }
.dcApp[data-studio] .dcStudioImageCandidates { padding-block:9px; }
.dcApp[data-studio] .dcStudioImageCandidates article { border:1px solid var(--dc-line);border-radius:var(--dc-card-radius);padding:8px;min-width:185px; }
.dcApp[data-studio] .dcStudioImagePreview { max-width:100%;background:var(--dc-soft);border-radius:7px; }
.dcStudioImagePlaceholder { display:grid;place-content:center;color:var(--dc-muted); }
.dcStudioImageCompare {
  width:min(830px,calc(100% - 40px));max-height:calc(100% - 40px);padding:16px;
  background:var(--dc-raised);color:var(--dc-ink);border:1px solid var(--dc-line);
  border-radius:var(--dc-float-radius);box-shadow:var(--dc-float-shadow);
  animation:dcStudioDialog var(--dc-panel) var(--dc-ease) both;
}
.dcStudioImageCompare::backdrop { background:var(--dc-scrim); }
.dcStudioImageCompareGrid { display:grid;grid-auto-flow:column;grid-auto-columns:minmax(0,1fr);gap:12px;margin-top:9px; }
.dcStudioImageCompareGrid figure { margin:0;min-width:0; }
.dcStudioImageCompareGrid figcaption { margin:0 0 6px;color:var(--dc-muted);font-size:12px; }
.dcApp[data-studio] .dcStudioImageCompareGrid .dcStudioImagePreview { width:100%;height:clamp(140px,42vh,370px);object-fit:contain; }
.dcApp[data-studio] .dcStudioViewportControls .dcBtn { width:28px;height:28px; }
.dcStudioCreateForm { display:grid;grid-template-columns:1fr 1fr;gap:12px; }
.dcStudioCreateForm>label { display:grid;gap:4px;color:var(--dc-secondary); }
.dcStudioCreateForm .dcStudioWide { grid-column:1/-1; }
.dcStudioCreateChoices { display:flex;gap:6px;flex-wrap:wrap; }
.dcApp[data-studio] .dcNativeConfirm { position:absolute;inset:0;background:var(--dc-scrim);z-index:16;padding:20px; }
.dcApp[data-studio] .dcNativeConfirmCard { background:var(--dc-raised);padding:20px;border:1px solid var(--dc-line);border-radius:var(--dc-float-radius);box-shadow:var(--dc-float-shadow);animation:dcStudioDialog var(--dc-panel) var(--dc-ease) both; }
.dcApp[data-studio] .dcNativeFileDialog .dcNativeConfirmCard { border:0;border-radius:0;box-shadow:none; }
.dcApp[data-studio] .dcToast { background:var(--dc-ink);color:var(--dc-raised);border-radius:10px;box-shadow:var(--dc-float-shadow);animation:dcStudioReveal var(--dc-menu) var(--dc-ease) both; }
.dcStudioInspect { z-index:6;position:absolute;top:12px;right:12px;max-height:calc(100% - 24px);width:min(265px,calc(100% - 24px));padding:11px;overflow:auto;border:1px solid var(--dc-line);background:var(--dc-raised);border-radius:var(--dc-card-radius);box-shadow:var(--dc-float-shadow);animation:dcStudioPanel var(--dc-panel) var(--dc-ease) both; }
.dcStudioInspect details { border-top:1px solid var(--dc-line);padding-top:6px;margin-top:6px; }
.dcStudioInspect summary { cursor:pointer;font-weight:620; }
.dcStudioInspect .dcNativeContextTools { background:transparent;display:flex;flex-wrap:wrap;align-items:flex-start;border:0;padding:6px 0; }
.dcStudioInspect .dcNativeContextTools label { max-width:100%;flex-wrap:wrap; }
.dcStudioInspect .dcNativeContextTools input { max-width:100%; }
.dcStudioMetrics { display:grid;grid-template-columns:1fr 1fr;gap:6px;margin:7px 0; }
.dcStudioMetrics span { padding:5px 7px;background:var(--dc-soft);border-radius:5px;font-size:11.5px;font-variant-numeric:tabular-nums; }
.dcStudioNativeLoading { position:absolute;inset:0;display:grid;place-content:center;justify-items:center;gap:10px;z-index:3;color:var(--dc-muted);background:var(--dc-bg); }
.dcStudioSkeleton { background:var(--dc-soft);border-radius:5px;width:88px;height:5px;animation:dcStudioPulse 1.15s ease-in-out infinite alternate; }
.dc-motion { display:flex;flex-direction:column;position:relative;background:var(--dc-bg);overflow:hidden; }
.dcMotionLoading { align-items:center;justify-content:center;gap:10px;color:var(--dc-muted); }
.dcMotionHeader {
  position:relative;z-index:7;min-height:49px;display:flex;align-items:center;gap:6px;
  padding:0 12px;border-bottom:1px solid var(--dc-line);background:var(--dc-surface);flex:none;
}
.dcMotionHeader>.dcStudioEngineIcon { width:29px;height:29px; }
.dcMotionOptions { position:relative; }
.dcMotionOptionsMenu {
  position:absolute;right:0;top:40px;z-index:5;width:min(248px,75vw);display:grid;gap:5px;
  padding:10px;background:var(--dc-raised);border:1px solid var(--dc-line);border-radius:var(--dc-card-radius);
  box-shadow:var(--dc-float-shadow);animation:dcStudioMenu var(--dc-menu) var(--dc-ease) both;transform-origin:top right;
}
.dcMotionOptionsMenu label { display:grid;gap:3px;color:var(--dc-muted);font-size:11.5px;padding:4px; }
.dcMotionOptionsMenu select { width:100%;max-width:100%; }
.dcApp[data-studio] .dcMotionOptionsMenu .dcBtn { justify-content:flex-start; }
.dcMotionNotice { flex:none;display:flex;gap:8px;align-items:center;flex-wrap:wrap;min-height:32px;padding:3px 12px;background:var(--dc-surface);border-bottom:1px solid var(--dc-line);font-size:12px; }
.dcMotionNotice progress { width:min(128px,30%);height:8px;accent-color:var(--dc-accent); }
.dcMotionRenderError { flex:1;min-width:0;overflow-wrap:anywhere;color:var(--dc-danger); }
.dcMotionViewport {
  position:relative;display:grid;place-items:safe center;flex:1;min-height:95px;overflow:auto;
  background:radial-gradient(circle at 48% 38%,var(--dc-soft),var(--dc-bg) 72%);
}
.dcMotionFrame { position:relative;overflow:hidden;background:#222128;border-radius:7px;box-shadow:0 8px 28px #12101c26; }
.dcMotionFrame iframe { display:block;width:100%;height:100%;border:0; }
.dcMotionFrameSelection { position:absolute;outline:2px solid #bcabff;outline-offset:3px;pointer-events:none; }
.dcMotionPlayback {
  display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);gap:6px;align-items:center;min-height:42px;
  padding:3px 12px;background:var(--dc-surface);border-top:1px solid var(--dc-line);flex:none;
}
.dcMotionPlayback select { justify-self:end;max-width:100%; }
.dcMotionTransport { display:flex;align-items:center;gap:2px; }
.dcMotionTime,.dcMotionFrameReadout,.dcMotionTicks,.dcMotionFps { color:var(--dc-muted);font:11.5px/1.3 var(--dc-mono);font-variant-numeric:tabular-nums;white-space:nowrap; }
.dcMotionSelection { display:flex;gap:5px;align-items:center;padding:3px 10px;background:var(--dc-surface);flex:none; }
.dcMotionSelection .dcStudioTarget { max-width:calc(100% - 120px); }
.dcMotionTimeline { flex:none;background:var(--dc-surface);border-top:1px solid var(--dc-line); }
.dcMotionTimeHead { display:flex;align-items:center;gap:9px;padding:6px 12px;min-height:33px; }
.dcMotionTimeHead strong { flex:1;font-weight:645; }
.dcMotionTimelineScroll {
  --dc-lane-label:110px;position:relative;display:grid;grid-template-columns:var(--dc-lane-label) minmax(0,1fr);
  max-height:clamp(74px,21vh,185px);padding:0 12px 8px 0;overflow:auto;overscroll-behavior:contain;
}
.dcMotionLaneName { display:flex;align-items:center;gap:5px;min-width:0;padding:3px 5px 3px 10px;color:var(--dc-muted);font-size:11px; }
.dcMotionLaneName span { min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap; }
.dcMotionRuler { position:relative;display:grid;gap:0;min-height:33px;z-index:2; }
.dcMotionTicks { display:flex;justify-content:space-between;gap:4px;pointer-events:none; }
.dcMotionRuler input { min-width:0;width:100%;margin:0;height:18px;cursor:ew-resize;accent-color:var(--dc-accent); }
.dcMotionLane {
  position:relative;min-height:26px;border-top:1px solid var(--dc-line);margin-top:2px;
  background:repeating-linear-gradient(to right,transparent,transparent calc(25% - 1px),var(--dc-line) calc(25% - 1px),var(--dc-line) 25%);
}
.dcMotionClip {
  position:absolute;top:3px;bottom:2px;min-width:3px;display:block;overflow:hidden;padding:0 6px;text-align:left;
  background:var(--dc-tint);color:var(--dc-accent);border:1px solid color-mix(in srgb,var(--dc-accent) 25%,var(--dc-tint));border-radius:5px;
  cursor:pointer;font-size:11px;transition:background-color var(--dc-fast),color var(--dc-fast);
}
.dcMotionClip span { display:block;text-overflow:ellipsis;white-space:nowrap;overflow:hidden; }
.dcMotionClip[data-kind=audio] { background:color-mix(in srgb,var(--dc-success) 16%,var(--dc-surface));color:var(--dc-success); }
.dcMotionClip:is(:hover,[aria-pressed=true]) { border-color:var(--dc-accent); }
.dcMotionClip[aria-pressed=true] { background:var(--dc-accent);color:var(--dc-on-accent); }
.dcMotionKeyframe { position:absolute;top:1px;width:5px;height:5px;transform:translateX(-50%) rotate(45deg);background:currentColor;opacity:.75; }
.dcMotionEmptyLane { grid-column:2;color:var(--dc-muted);font-size:11.5px;padding:5px 0; }
.dcMotionTimelineNote { padding:2px 10px 4px;color:var(--dc-muted);font-size:11px; }
.dcMotionPlayhead {
  position:absolute;z-index:3;left:var(--dc-lane-label);right:12px;top:31px;bottom:0;
  pointer-events:none;overflow:hidden;
}
.dcMotionPlayhead::before {
  content:'';display:block;width:1px;height:100%;background:var(--dc-accent);
  transform:translateX(var(--dc-playhead,0px));
}
@container (max-width:470px) {
  .dcMotionTime { font-size:10px; }
  .dcMotionTimelineScroll { --dc-lane-label:82px; }
  .dcMotionTicks span:nth-child(2),.dcMotionTicks span:nth-child(4) { display:none; }
}
@keyframes dcStudioPulse { from { opacity:.48 } to { opacity:1 } }
@keyframes dcStudioReveal { from { opacity:0;transform:translateY(5px) } to { opacity:1;transform:translateY(0) } }
@keyframes dcStudioPanel { from { opacity:0;transform:translateX(-10px) } to { opacity:1;transform:translateX(0) } }
@keyframes dcStudioMenu { from { opacity:0;transform:translateY(-4px) scale(.99) } to { opacity:1;transform:translateY(0) scale(1) } }
@keyframes dcStudioDialog { from { opacity:0;transform:translateY(7px) scale(.985) } to { opacity:1;transform:translateY(0) scale(1) } }
@container (max-width:610px) {
  .dcStudioFileActions .dcStudioCompactText { display:none; }
  .dcApp[data-studio] .dcStudioFileActions .dcBtn:has(.dcStudioCompactText) { width:34px;padding:0; }
  .dcStudioFileActions [data-save-indicator] { display:none; }
  .dcApp[data-studio] .dcNativeHeader { padding:0 6px; }
  .dcStudioOrbit { width:82px;height:82px; }
  .dcStudioStart { grid-template-columns:33px minmax(0,1fr);gap:8px; }
  .dcStudioStart>svg { display:none; }
}
@container (max-width:480px) {
  .dcStudioHistoryButton .dcStudioCompactText { display:none; }
  .dcApp[data-studio] .dcNativeEmpty { padding:16px; }
  .dcStudioOrbit { display:none; }
  .dcStudioHomeHero { display:block;margin-bottom:15px; }
  .dcStudioHomeLinks { margin-top:9px; }
  .dcApp[data-studio] .dcNativePopover[data-menu=works] .dcNativeWorksList { grid-template-columns:repeat(2,minmax(0,1fr)); }
  .dcStudioFileActions [data-secondary-action] { display:none; }
  .dcApp[data-studio] .dcAiCanvasTarget small { display:none; }
  .dcApp[data-studio] .dcAiCanvasTools { padding-inline:6px;gap:3px; }
  .dcApp[data-studio] .dcAiCanvasTools .dcBtn { padding-inline:6px; }
}
@container (max-width:690px) {
  .dcStudioBody>.dcChatColumn { position:absolute;inset:0 auto 0 0;z-index:10;max-width:calc(100% - 44px);box-shadow:var(--dc-float-shadow); }
  .dcStudioBody>.dcChatSplit { display:none; }
}
@media (prefers-reduced-motion:reduce) {
  .dcApp[data-studio] *, .dcApp[data-studio] *::before, .dcApp[data-studio] *::after {
    animation-duration:.01ms!important;transition-duration:.01ms!important;scroll-behavior:auto!important;
  }
}
`;
