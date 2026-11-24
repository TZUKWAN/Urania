import {storeView} from './store-view.js?v=169';
import {createStudioComponents,userFacingError} from './studio-system.js?v=169';

const activeRender=new Set(['starting','running','rendering','verifying','cleaning','cancelling']);
const renderLabel={
  starting:'正在准备导出',running:'正在渲染',rendering:'正在渲染',verifying:'正在验证视频',
  cleaning:'正在收尾',cancelling:'正在取消',completed:'视频已导出',cancelled:'已取消',failed:'导出失败',
};
const formatSeconds=value=>Number.isFinite(value)?value.toFixed(2)+' 秒':'';
const fpsValue=fps=>fps.num/fps.den;

export function createMotionWorkspace({h,store,actions,React}) {
  const {Icon,Button,Status}=createStudioComponents(React);
  const {useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore}=React;

  function Playhead({frame,playing,total,rate}) {
    const node=useRef(null);
    useLayoutEffect(()=>{
      const el=node.current;
      if(!el)return;
      const width=el.clientWidth;
      const show=position=>el.style.setProperty('--dc-playhead',Math.max(0,Math.min(1,position/Math.max(1,total-1)))*width+'px');
      show(frame);
      if(!playing||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
      let raf=0;const start=performance.now();
      const draw=now=>{
        show((frame+Math.max(0,now-start)*rate/1000)%total);
        raf=requestAnimationFrame(draw);
      };
      raf=requestAnimationFrame(draw);
      return()=>cancelAnimationFrame(raf);
    },[frame,playing,rate,total]);
    return h('div',{ref:node,className:'dcMotionPlayhead','aria-hidden':true});
  }

  function Timeline({motion}) {
    const {durationFrames:total,currentFrame:frame,fps}=motion,rate=fpsValue(fps),durationMs=total/rate*1000;
    const tracks=useMemo(()=>{
      const groups=new Map();
      for(const clip of motion.timeline?.clips||[]){
        const key=clip.track===null?'clip:'+clip.id:'track:'+clip.track;
        const group=groups.get(key)||{key,label:clip.track===null?clip.label:'轨道 '+clip.track,kind:clip.kind,items:[]};
        group.items.push(clip);groups.set(key,group);
      }
      return [...groups.values()].sort((a,b)=>(a.items[0].track??1000)-(b.items[0].track??1000)||a.items[0].start-b.items[0].start);
    },[motion.timeline]);
    const pending=useRef(0),target=useRef(0);
    useEffect(()=>()=>cancelAnimationFrame(pending.current),[motion.projectId]);
    const seek=event=>{
      target.current=event.target.valueAsNumber;
      if(!pending.current)pending.current=requestAnimationFrame(()=>{pending.current=0;actions.seekMotionFrame(target.current);});
    };
    const chosen=motion.selection?.ids||[];
    const clipButton=clip=>h('button',{
      key:clip.id,type:'button',className:'dcMotionClip','data-kind':clip.kind,'aria-pressed':chosen.includes(clip.id),
      'aria-label':'选择片段 '+clip.label,title:clip.label+' · '+formatSeconds(clip.start/1000)+'–'+formatSeconds(clip.end/1000),disabled:!motion.previewReady,
      style:{left:clip.start/durationMs*100+'%',width:(clip.end-clip.start)/durationMs*100+'%'},onClick:event=>actions.selectMotionClip(clip,event.shiftKey),
    },h('span',null,clip.label),...clip.keys.map(time=>h('i',{
      key:time,className:'dcMotionKeyframe','aria-hidden':true,title:'关键帧 '+formatSeconds(time/1000),
      style:{left:(time-clip.start)/(clip.end-clip.start)*100+'%'},
    })));
    return h('section',{className:'dcMotionTimeline','aria-label':'动画时间轴'},
      h('div',{className:'dcMotionTimeHead'},
        h('strong',null,'时间轴'),h('span',{className:'dcMotionFrameReadout'},'第 '+(frame+1)+' / '+total+' 帧'),
        h('span',{className:'dcMotionFps'},Number(rate.toFixed(3))+' fps')),
      h('div',{className:'dcMotionTimelineScroll'},
        h('div',{className:'dcMotionLaneName dcMotionRulerName'},h(Icon,{name:'clock',size:14}),'时间'),
        h('div',{className:'dcMotionRuler'},
          h('div',{className:'dcMotionTicks','aria-hidden':true},...Array.from({length:5},(_,i)=>h('span',{key:i},formatSeconds(durationMs/1000*i/4)))),
          h('input',{type:'range',min:0,max:Math.max(0,total-1),value:frame,'aria-label':'播放头','aria-valuetext':formatSeconds(frame/rate)+'，第 '+(frame+1)+' 帧',disabled:!motion.previewReady,onChange:seek})),
        tracks.length?tracks.map(track=>h(React.Fragment,{key:track.key},
          h('div',{className:'dcMotionLaneName',title:track.label},h(Icon,{name:track.kind==='audio'?'clock':'film',size:13}),h('span',null,track.label)),
          h('div',{className:'dcMotionLane'},...track.items.map(clipButton)))) :
          h('div',{className:'dcMotionEmptyLane'},motion.previewReady?'当前动画未标记可单独选择的组件。':'正在读取动画结构…'),
        h(Playhead,{frame,playing:motion.playing,total,rate})),
      motion.timeline?.truncated?h('div',{className:'dcMotionTimelineNote'},'显示前 96 个可识别组件。'):null);
  }

  function Preview({motion}) {
    const iframe=useRef(null),viewport=useRef(null);
    const [available,setAvailable]=useState(null);
    const [zoom,setZoom]=useState(1);
    useLayoutEffect(()=>{
      if(!viewport.current)return;
      const observer=new ResizeObserver(([entry])=>{
        const {width,height}=entry.contentRect;
        setAvailable(current=>current?.width===width&&current?.height===height?current:{width,height});
      });
      observer.observe(viewport.current);
      return()=>observer.disconnect();
    },[]);
    useEffect(()=>motion.preview&&iframe.current?actions.bindMotionPreview(iframe.current):undefined,[motion.preview?.nonce]);
    const {width,height}=motion.render;
    const fit=available?Math.max(.02,Math.min((available.width-36)/width,(available.height-28)/height))*zoom:1;
    const rect=motion.selection?.rect;
    return h(React.Fragment,null,
      h('div',{className:'dcMotionViewport',ref:viewport},
        motion.preview?h('div',{className:'dcMotionFrame',style:{width:Math.round(width*fit),height:Math.round(height*fit)}},
          h('iframe',{ref:iframe,id:'motion-preview',key:motion.preview.nonce,src:actions.motionPreviewUrl(motion),onLoad:actions.motionPreviewAutoplay,title:'动画预览',
            sandbox:'allow-scripts allow-same-origin',referrerPolicy:'no-referrer',allow:'autoplay'}),
          rect?h('div',{className:'dcMotionFrameSelection','aria-hidden':true,style:{left:rect.x*100+'%',top:rect.y*100+'%',width:Math.min(rect.width,1-rect.x)*100+'%',height:Math.min(rect.height,1-rect.y)*100+'%'}}):null):null,
        !motion.previewReady?h('div',{className:'dcStudioNativeLoading',role:motion.previewError?'alert':'status'},
          motion.previewError?h(Icon,{name:'warning'}):h('span',{className:'dcStudioSkeleton','aria-hidden':true}),
          motion.previewError?userFacingError(motion.previewError,'无法加载动画预览，请检查素材。'):'正在准备动画预览…'):null),
      h('div',{className:'dcMotionPlayback','aria-label':'播放控制'},
        h('span',{className:'dcMotionTime'},formatSeconds(motion.currentFrame/fpsValue(motion.fps))+' / '+formatSeconds(motion.durationFrames/fpsValue(motion.fps))),
        h('div',{className:'dcMotionTransport'},
          h(Button,{icon:'start',label:'转到开头',disabled:!motion.previewReady,onClick:()=>actions.seekMotionFrame(0)}),
          h(Button,{icon:motion.playing?'pause':'play',label:motion.playing?'暂停':'播放',disabled:!motion.previewReady,onClick:actions.toggleMotionPlay,className:'dcPrimary'}),
          h(Button,{icon:'end',label:'转到末帧',disabled:!motion.previewReady,onClick:()=>actions.seekMotionFrame(motion.durationFrames-1)})),
        h('select',{className:'dcSelect','aria-label':'预览缩放',value:zoom,onChange:event=>setZoom(Number(event.target.value))},
          h('option',{value:.75},'适应 × 0.75'),h('option',{value:1},'适应画面'),h('option',{value:1.35},'适应 × 1.35'))));
  }

  const readMotion=storeView(store,s=>({motion:s.motion,services:s.services,designAssistant:s.designAssistant,
    motionAssetTransfer:s.motionAssetTransfer,motionProjects:s.motionProjects,motionTemplates:s.motionTemplates,motionEnvironment:s.motionEnvironment}));
  function MotionWorkspace({onFocusChat}) {
    const snapshot=useSyncExternalStore(store.subscribe,readMotion,readMotion),m=snapshot.motion;
    const scopeKey=actions.motionScopeKey();
    const [error,setError]=useState(null);
    const [openOptions,setOptions]=useState(false);
    const [loading,setLoading]=useState(false);
    const chooser=useRef(null);
    useEffect(()=>{
      if(!scopeKey)return;
      let alive=true;setError(null);
      actions.motionAutoEnter()
        .then(()=>actions.listMotionProjects()).catch(cause=>{if(alive)setError(userFacingError(cause));});
      actions.listMotionTemplates().catch(()=>{});
      const timer=setInterval(()=>{actions.motionPollHead().catch(()=>{});},1500);
      return()=>{alive=false;clearInterval(timer);actions.closeMotionWorkspace();};
    },[scopeKey]);
    useEffect(()=>{
      if(!openOptions)return;
      const close=event=>{
        if(event.key==='Escape'&&!event.isComposing){setOptions(false);chooser.current?.querySelector('button')?.focus();return;}
        if(event.type==='pointerdown'&&!chooser.current?.contains(event.target))setOptions(false);
      };
      document.addEventListener('keydown',close);document.addEventListener('pointerdown',close);
      return()=>{document.removeEventListener('keydown',close);document.removeEventListener('pointerdown',close);};
    },[openOptions]);
    const invoke=fn=>async()=>{
      if(loading)return;setLoading(true);setError(null);
      try{await fn();}catch(cause){setError(userFacingError(cause));}finally{setLoading(false);}
    };
    const updateProject=fn=>invoke(async()=>{await fn();await actions.listMotionProjects();setOptions(false);});
    if(!m?.projectId||!scopeKey||m.scope?.sessionId!==snapshot.services.designAssistant?.scope()?.sessionId){
      return h('section',{className:'dc-motion dcMotionLoading',role:error?'alert':'status'},
        error?h(React.Fragment,null,h(Icon,{name:'warning'}),error,h(Button,{icon:'plus',onClick:updateProject(()=>actions.motionAutoEnter())},'重试打开动画')):
          h(React.Fragment,null,h('span',{className:'dcStudioSkeleton','aria-hidden':true}),'正在打开动画工作区…'));
    }
    const status=m.renderStatus,working=activeRender.has(status?.status),verified=status?.status==='completed'&&status.receipt?.verified;
    const transfer=snapshot.motionAssetTransfer?.sessionId===m.scope.sessionId&&snapshot.motionAssetTransfer?.root===m.scope.root?snapshot.motionAssetTransfer:null;
    const progress=working&&status.progress>0&&Number.isFinite(status.progress)?Math.max(0,Math.min(100,status.progress)):null;
    return h('section',{className:'dc-motion','aria-label':'动画工作区'},
      h('header',{className:'dcMotionHeader'},
        h('span',{className:'dcStudioEngineIcon','data-engine':'motion'},h(Icon,{name:'motion'})),
        h('div',{className:'dcNativeTitle'},h('strong',{title:m.title},m.title||'动画'),h('small',null,m.render.width+' × '+m.render.height+' · '+Number(fpsValue(m.fps).toFixed(3))+' fps')),
        h('div',{className:'dcMotionOptions',ref:chooser},
          h(Button,{icon:'more',label:'动画项目和导出选项','aria-expanded':openOptions,onClick:()=>setOptions(value=>!value)}),
          openOptions?h('div',{className:'dcMotionOptionsMenu',role:'dialog','aria-label':'动画项目和导出选项'},
            h('label',null,'动画作品',h('select',{className:'dcSelect','aria-label':'打开其他动画项目',value:m.projectId,disabled:working||loading,onChange:event=>updateProject(()=>actions.openMotionProject(event.target.value))()},
              ...(snapshot.motionProjects||[]).map(project=>h('option',{key:project.projectId,value:project.projectId},project.title||'未命名动画')))),
            h('label',null,'从模板开始',h('select',{className:'dcSelect','aria-label':'动画模板',value:'',disabled:working||loading,onChange:event=>{const id=event.target.value;if(id)updateProject(()=>actions.createMotionFromTemplate(id))();}},
              h('option',{value:''},'选择模板'),...(snapshot.motionTemplates||[]).map(template=>h('option',{key:template.id,value:template.id},template.title||template.id)))),
            h(Button,{icon:'plus',disabled:working||loading,onClick:updateProject(()=>actions.createMotionProject())},'新建动画'),
            h(Button,{icon:'settings',disabled:loading,onClick:invoke(actions.motionDoctor)},'检查导出环境'),
            h(Button,{icon:'download',disabled:loading,onClick:invoke(actions.exportMotionProject)},'导出可编辑工程')):null),
        h(Button,{icon:'download',className:'dcPrimary',disabled:working||loading,onClick:invoke(actions.renderMotion)},status?.status==='failed'||status?.status==='cancelled'?'重试导出 MP4':'导出 MP4')),
      snapshot.motionEnvironment?h('div',{className:'dcMotionNotice'},
        h(Status,{kind:snapshot.motionEnvironment.available?'success':'warning'},snapshot.motionEnvironment.available?'导出环境已就绪':snapshot.motionEnvironment.error),
        !snapshot.motionEnvironment.available?h('span',null,snapshot.motionEnvironment.recovery):null):null,
      error?h('div',{className:'dcNativeNotice',role:'alert'},h(Icon,{name:'warning',size:15}),h('span',null,error)):null,
      status?h('div',{className:'dcMotionNotice'},
        h(Status,{kind:verified?'success':status.status==='failed'?'error':working?'busy':'neutral'},renderLabel[status.status]||'正在核对导出状态'),
        status.error?h('span',{className:'dcMotionRenderError'},userFacingError(status.error,'导出未完成，请检查环境并重试。')):null,
        progress!==null?h('progress',{max:100,value:progress,'aria-label':'导出进度'}):null,
        working&&status.jobId?h(Button,{disabled:status.status==='cancelling',onClick:invoke(actions.cancelMotionRender)},status.status==='cancelling'?'正在取消…':'取消导出'):null,
        verified?h(Button,{icon:'download',onClick:invoke(actions.downloadMotionArtifact)},'下载 MP4'):null):null,
      transfer?h('div',{className:'dcMotionNotice'},
        h(Icon,{name:'assets',size:15}),h('span',null,transfer.title+' · '+transfer.format.toUpperCase()+' · 来源 '+transfer.sourceTitle),
        h(Button,{icon:'plus',className:'dcPrimary',disabled:working||loading||!m.previewReady,onClick:invoke(()=>actions.importMotionNativeAsset(transfer))},'加入当前动画'),
        h(Button,{icon:'close',label:'取消素材传递',onClick:()=>store.set({motionAssetTransfer:null})})):null,
      m.materialReference?h('div',{className:'dcMotionNotice'},
        h(Status,{kind:'success'},'素材已加入项目'),h('span',null,m.materialReference.name||m.materialReference.path.split('/').at(-1)),
        h(Button,{icon:'ai',onClick:onFocusChat},'交给 AI 放进动画')):null,
      h(Preview,{motion:m}),
      m.selection?.ids?.length?h('div',{className:'dcMotionSelection'},
        h('span',{className:'dcStudioTarget'},h(Icon,{name:'motion',size:13}),h('span',null,m.selection.ids.length===1?m.selection.text||m.selection.ids[0]:'已选 '+m.selection.ids.length+' 个组件')),
        h(Button,{icon:'ai',onClick:onFocusChat},'让 AI 修改'),h(Button,{icon:'close',label:'取消动画选区',onClick:()=>actions.selectMotionClip(null)})):null,
      h(Timeline,{motion:m}));
  }
  return {MotionWorkspace};
}
