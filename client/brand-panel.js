export function createBrandPanel(React){
 const h=React.createElement;
 const labels={recorded:'跟随主色',color_changed:'使用手动配色',disabled:'已停止跟随',source_changed:'源版本已改变',identity_changed:'对象身份已改变',object_unavailable:'对象不可用',source_unavailable:'作品不可用',engine_changed:'作品类型已改变'};
 const button=(title,onClick,disabled=false,props={})=>h('button',{type:'button',className:'dcBtn',onClick,disabled,...props},title);
 return function BrandPanel({snapshot,sources=[],canBind,canBindFont,working,submit,searchStyles,loadStyle,retainPackage,listThemes,listThemeFiles,loadTheme,checkContrast,auditColors,convertColor}){
  const [name,setName]=React.useState('');
  const [createColor,setCreateColor]=React.useState(null);
  const [resource,setResource]=React.useState('');
  const [changes,setChanges]=React.useState({});
  const [fontChanges,setFontChanges]=React.useState({});
  const [resourceQuery,setResourceQuery]=React.useState(''),[resourceResults,setResourceResults]=React.useState(null),[resourceOffset,setResourceOffset]=React.useState(0),[resourceBusy,setResourceBusy]=React.useState(false),[resourceError,setResourceError]=React.useState(null),[dynamicStyle,setDynamicStyle]=React.useState(null),[retainedPackage,setRetainedPackage]=React.useState(null);
  const [themeBundles,setThemeBundles]=React.useState(null),[themeBundle,setThemeBundle]=React.useState(''),[themeFiles,setThemeFiles]=React.useState(null),[themeOffset,setThemeOffset]=React.useState(0),[theme,setTheme]=React.useState(null),[themeSelection,setThemeSelection]=React.useState(null);
  const [themeRecordErrors,setThemeRecordErrors]=React.useState(0);
  const [contrastForeground,setContrastForeground]=React.useState('#000000'),[contrastBackground,setContrastBackground]=React.useState('#FFFFFF'),[contrastResult,setContrastResult]=React.useState(null);
  const [documentColorAudit,setDocumentColorAudit]=React.useState(null),[convertedColor,setConvertedColor]=React.useState(null);
  const contrastInputs=React.useRef({foreground:'#000000',background:'#FFFFFF'});
  if(!snapshot)return h('section',{className:'dcNativePopover',role:'dialog','aria-label':'项目品牌色'},'正在读取品牌色…');
  const selection=snapshot.selection;
  const fontState=snapshot.fontState||{tokens:{},bindings:[],updates:[],selection:null},fontSelection=fontState.selection;
  const selectedRecord=snapshot.bindings.find(row=>row.sourceId===selection?.sourceId&&row.nativeId===selection?.nativeId);
  const command=(kind,data)=>submit({command:kind,revision:snapshot.revision,...data});
  const create=event=>{
   event.preventDefault();
   return command('create',{name:name.trim(),primary:(createColor||selection?.fill||'#287D6C').toUpperCase(),...(resource?{resourceId:resource}:{}),...(themeSelection?{themeSource:{bundleId:themeSelection.bundleId,file:themeSelection.file,gitSha1:themeSelection.gitSha1,sha256:themeSelection.sha256}}:{})});
  };
  const search=async offset=>{
   setResourceBusy(true);setResourceError(null);
   try{const result=await searchStyles(resourceQuery.trim(),offset);setResourceResults(result);setResourceOffset(offset);}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const choose=async item=>{
   setResourceBusy(true);setResourceError(null);
   try{const prefix='design-systems/';if(!item.id.startsWith(prefix))throw new Error('资源不是设计系统');const style=await loadStyle(item.id.slice(prefix.length));setDynamicStyle(style);setResource(style.id);setCreateColor(style.primary);setThemeSelection(null);setRetainedPackage(null);}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const retain=async id=>{
   setResourceBusy(true);setResourceError(null);
   try{setRetainedPackage(await retainPackage('design-systems/'+id));}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const showThemeBundles=async()=>{
   setResourceBusy(true);setResourceError(null);
   try{const result=await listThemes();if(!Array.isArray(result.items))throw new Error('外部资源列表无效');setThemeBundles(result.items.filter(item=>item.odId==='skills/theme-factory'&&!item.error));setThemeRecordErrors(result.items.filter(item=>item.error).length);setThemeBundle('');setThemeFiles(null);setTheme(null);setThemeSelection(null);}
   catch(error){setThemeBundles(null);setThemeRecordErrors(0);setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const showThemeFiles=async(id,offset=0)=>{
   setResourceBusy(true);setResourceError(null);
   try{const result=await listThemeFiles(id,offset);if(result.bundle?.id!==id)throw new Error('主题原包身份不一致');setThemeBundle(id);setThemeFiles(result);setThemeOffset(offset);setTheme(null);setThemeSelection(null);}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const chooseTheme=async file=>{
   setResourceBusy(true);setResourceError(null);
   try{const result=await loadTheme(themeBundle,file);if(result.bundleId!==themeBundle||result.file!==file||!/^[a-f0-9]{40}$/.test(result.gitSha1||'')||!/^[a-f0-9]{64}$/.test(result.sha256||'')||!Array.isArray(result.colors)||!result.colors.length||result.colors.some(item=>!/^#[0-9A-F]{6}$/.test(item.hex||'')))throw new Error('主题来源或配色不一致');setTheme(result);setThemeSelection(null);setResource('');}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  const calculateContrast=async()=>{
   setResourceBusy(true);setResourceError(null);setContrastResult(null);
   try{const foreground=contrastForeground.toUpperCase(),background=contrastBackground.toUpperCase(),result=await checkContrast(foreground,background);if(contrastInputs.current.foreground.toUpperCase()!==foreground||contrastInputs.current.background.toUpperCase()!==background)return;if(result.foreground!==foreground||result.background!==background||typeof result.ratio!=='number'||!Number.isFinite(result.ratio)||result.ratio<1||result.ratio>21+1e-9||!result.thresholds||['aaNormalText','aaLargeText','aaaNormalText','aaaLargeText'].some(key=>typeof result.thresholds[key]!=='boolean'))throw new Error('颜色对比结果无效');setContrastResult(result);}
   catch(error){setResourceError(error.message);}finally{setResourceBusy(false);}
  };
  return h('section',{className:'dcNativePopover dcBrandPanel','data-menu':'brands',role:'dialog','aria-label':'项目品牌色'},
   h('form',{onSubmit:create,className:'dcBrandControls'},
    h('label',null,'品牌名称',h('input',{className:'dcInput','aria-label':'品牌名称',maxLength:120,value:name,onChange:e=>setName(e.target.value)})),
    h('label',null,'设计系统',h('select',{'aria-label':'品牌设计系统',value:resource,onChange:e=>{
     const style=snapshot.styles.find(s=>s.id===e.target.value)||((dynamicStyle?.id===e.target.value)?dynamicStyle:null);setResource(e.target.value);setThemeSelection(null);setCreateColor(style?.primary||selection?.fill||null);
    }},h('option',{value:''},'自定义'),...(snapshot.styles||[]).map(s=>h('option',{key:s.id,value:s.id},s.name)),dynamicStyle&&!snapshot.styles.some(s=>s.id===dynamicStyle.id)?h('option',{value:dynamicStyle.id},dynamicStyle.name):null)),
    h('label',null,'主色',h('input',{type:'color','aria-label':'新品牌主色',value:createColor||selection?.fill||'#287D6C',onChange:e=>{setResource('');setThemeSelection(null);setCreateColor(e.target.value);}})),
    h('button',{type:'submit',className:'dcBtn',disabled:working||resourceBusy||!name.trim()},'创建品牌')),
   searchStyles&&loadStyle?h('div',{className:'dcBrandControls'},
    h('input',{className:'dcInput','aria-label':'搜索 OpenDesign 设计系统',placeholder:'搜索更多设计系统',value:resourceQuery,maxLength:160,onChange:e=>setResourceQuery(e.target.value)}),
    button('搜索设计系统',()=>search(0),working||resourceBusy),
    resourceResults?h('span',null,'找到 '+resourceResults.total+' 项'):null,
    resourceResults?.items?.map(item=>button(item.name,()=>choose(item),working||resourceBusy,{key:item.id,'aria-label':'选择设计系统 '+item.name})),
    resourceResults&&resourceOffset>0?button('上一页',()=>search(Math.max(0,resourceOffset-20)),working||resourceBusy):null,
    resourceResults?.nextOffset!=null?button('下一页',()=>search(resourceResults.nextOffset),working||resourceBusy):null,
    resourceError?h('span',{role:'alert'},resourceError):null,
    dynamicStyle&&resource===dynamicStyle.id?h('span',{role:'status'},dynamicStyle.warning):null,
    dynamicStyle&&resource===dynamicStyle.id&&retainPackage?button('保存完整设计系统原包',()=>retain(dynamicStyle.id),working||resourceBusy):null,
    retainedPackage&&resource===dynamicStyle?.id?h('span',{role:'status'},'已保存 '+retainedPackage.fileCount+' 个原文件至 '+retainedPackage.asset.path+'；'+retainedPackage.warning):null):null,
   listThemes&&listThemeFiles&&loadTheme?h('div',{className:'dcBrandControls'},
    button('读取已保存主题',showThemeBundles,working||resourceBusy),
    themeBundles?h('span',null,themeBundles.length?'选择主题原包':'当前项目没有可识别的 theme-factory 原包'):null,
    themeRecordErrors?h('span',{role:'status'},'另有 '+themeRecordErrors+' 条外部资源记录无法读取，需先核对；无法判断其是否为主题。'):null,
    ...(themeBundles||[]).map(item=>button((item.revision||item.id).slice(0,12),()=>showThemeFiles(item.id),working||resourceBusy,{key:item.id,title:item.id})),
    themeFiles?h('span',null,'选择主题文件'):null,
    ...(themeFiles?.items||[]).filter(item=>/^skills\/theme-factory\/themes\/[a-z0-9][a-z0-9-]{0,79}\.md$/.test(item.path||'')&&!item.lfs).map(item=>button(item.path.split('/').pop(),()=>chooseTheme(item.path),working||resourceBusy,{key:item.path})),
    themeFiles&&themeOffset>0?button('上一页主题文件',()=>showThemeFiles(themeBundle,Math.max(0,themeOffset-100)),working||resourceBusy):null,
    themeFiles?.nextOffset!=null?button('下一页主题文件',()=>showThemeFiles(themeBundle,themeFiles.nextOffset),working||resourceBusy):null,
    theme?h('span',null,theme.title+'：选择一个颜色作为新品牌主色'):null,
    ...(theme?.colors||[]).map(item=>button(item.name+' '+item.hex,()=>{setResource('');setCreateColor(item.hex);setThemeSelection({bundleId:theme.bundleId,file:theme.file,gitSha1:theme.gitSha1,sha256:theme.sha256});},working||resourceBusy,{key:item.name,'aria-pressed':!!themeSelection&&createColor===item.hex})),
    themeSelection?h('span',{role:'status'},'已选择 '+createColor+'；创建品牌会保留主题原文来源，不自动修改作品或安装字体。'):null):null,
   checkContrast?h('div',{className:'dcBrandControls'},
    h('span',null,'对比指定颜色（不读取当前作品）'),
    h('label',null,'前景',h('input',{type:'color',value:contrastForeground,disabled:working||resourceBusy,'aria-label':'对比前景色',onChange:e=>{contrastInputs.current.foreground=e.target.value;setContrastForeground(e.target.value);setContrastResult(null);}})),
    h('label',null,'背景',h('input',{type:'color',value:contrastBackground,disabled:working||resourceBusy,'aria-label':'对比背景色',onChange:e=>{contrastInputs.current.background=e.target.value;setContrastBackground(e.target.value);setContrastResult(null);}})),
    button('计算文字对比',calculateContrast,working||resourceBusy),
    convertColor?button('转换为 OKLCH',async()=>{setResourceBusy(true);setResourceError(null);try{setConvertedColor(await convertColor(contrastForeground));}catch(e){setResourceError(e.message);}finally{setResourceBusy(false);}},working||resourceBusy):null,
    auditColors?button('检查整稿文字颜色',async()=>{setResourceBusy(true);setResourceError(null);try{setDocumentColorAudit(await auditColors());}catch(e){setResourceError(e.message);}finally{setResourceBusy(false);}},working||resourceBusy):null,
    convertedColor?h('p',null,convertedColor.css):null,
    contrastResult?.apca?h('p',null,'APCA Lc '+contrastResult.apca.lc.toFixed(2)+'（实验性指标）'):null,
    documentColorAudit?h('details',null,h('summary',null,'整稿检查：'+documentColorAudit.coverage.measured+' 处已计算，'+documentColorAudit.coverage.unresolved+' 处背景或文字颜色待确认'),h('p',null,'源结构检查；不把未解析的渐变、透明、遮挡或主题继承冒称合规。'),h('p',null,'界面各列最多显示100项；完整结果见JSON报告。'),button('下载完整颜色报告',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(documentColorAudit,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='designcraft-color-audit-'+documentColorAudit.source.nativeSourceSha256.slice(0,16)+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),30000);},working||resourceBusy),...documentColorAudit.findings.slice(0,100).map(item=>h('p',{key:item.path},item.text+' · WCAG '+item.wcagRatio.toFixed(2)+' / APCA '+item.apca.lc.toFixed(2))),...documentColorAudit.unresolved.slice(0,100).map(item=>h('p',{key:item.path},item.text+' · 未计算：'+item.reason))):null,
    contrastResult?h('span',{role:'status'},'对比度 '+(Math.floor(contrastResult.ratio*10000)/10000).toFixed(4)+':1（显示值截取）；普通文字 AA '+(contrastResult.thresholds.aaNormalText?'达到':'未达到')+'，大号文字 AA '+(contrastResult.thresholds.aaLargeText?'达到':'未达到')+'；仅为两色计算。'):null):null,
   ...snapshot.brands.map(brand=>{
    const rows=snapshot.bindings.filter(row=>row.brandId===brand.id);
    const active=rows.filter(row=>row.status!=='disabled');
    const overrides=active.filter(row=>row.status==='color_changed');
    const pending=snapshot.updates.find(tx=>tx.brandId===brand.id&&['prepared','partial'].includes(tx.status));
    const last=snapshot.updates.filter(tx=>tx.brandId===brand.id&&tx.status==='succeeded').at(-1);
    const blockers=active.filter(row=>!['recorded','color_changed'].includes(row.status));
    const next=changes[brand.id]||brand.primary;
    const family=fontState.tokens[brand.id],fontValue=fontChanges[brand.id]??family??fontSelection?.font??brand.resource?.font??'';
    const fontRows=fontState.bindings.filter(row=>row.brandId===brand.id),fontActive=fontRows.filter(row=>row.enabled),fontOverrides=fontActive.filter(row=>row.status!=='recorded');
    const selectedFontRow=fontState.bindings.find(row=>row.sourceId===fontSelection?.sourceId&&row.nativeId===fontSelection?.nativeId);
    const fontPending=fontState.updates.find(update=>update.brandId===brand.id&&['prepared','partial'].includes(update.status));
    const locked=working||!!pending;
    return h('article',{className:'dcBrandCard',key:brand.id,'data-brand':brand.id},
     h('div',{className:'dcBrandControls'},h('span',{className:'dcBrandChip',style:{backgroundColor:brand.primary},'aria-hidden':true}),h('strong',null,brand.name),h('span',null,brand.primary),brand.themeSource?h('span',null,'主题来源：'+brand.themeSource.file.split('/').pop()+'（初始 '+brand.themeSource.selectedHex+'）'):null,
      button('绑定所选填色',()=>command('attach',{brandId:brand.id,nativeId:selection.nativeId,sourceRevision:selection.sourceRevision}),locked||!canBind||!selection||!!selectedRecord||selection.fill!==brand.primary,{title:'选择与品牌主色一致的纯色路径或形状'})),
     rows.length?h('ul',null,...rows.map(row=>{
      const source=sources.find(s=>s.id===row.sourceId);
      return h('li',{key:row.id},h('span',null,(source?.title||row.sourceId)+' · 对象 '+row.nativeId+' · '+(labels[row.status]||row.status)),
       row.status==='disabled'?button('重新绑定',()=>command('enable',{brandId:brand.id,bindingId:row.id}),locked):button('停止跟随',()=>command('disable',{brandId:brand.id,bindingId:row.id}),locked));
     })):h('p',null,'选择与主色相同的路径或形状，再绑定其填色。'),
     h('div',{className:'dcBrandControls'},
      h('label',null,'新主色',h('input',{type:'color','aria-label':brand.name+'的新主色',value:next,onChange:e=>setChanges({...changes,[brand.id]:e.target.value.toUpperCase()})})),
      button(active.length?'更新品牌主色（同步 '+(active.length-overrides.length-blockers.length)+' 处）':'更新品牌主色',()=>command('recolor',{brandId:brand.id,primary:next,bindingIds:active.map(row=>row.id),overrideIds:overrides.map(row=>row.id)}),locked||next===brand.primary||!!blockers.length),
      overrides.length?h('span',null,'保留 '+overrides.length+' 处手动配色'):null),
     pending?h('div',{className:'dcBrandControls',role:'status'},h('span',null,'已保存 '+pending.done+'/'+pending.total+' 份作品'),button('继续品牌更新',()=>command('resume',{updateId:pending.id}),working)):null,
     !pending&&last?button('核对已保存版本',()=>command('resume',{updateId:last.id}),working):null,
     h('div',{className:'dcBrandControls'},h('strong',null,'品牌字体'),
      h('input',{className:'dcInput',style:{width:170},'aria-label':brand.name+'的品牌字体',placeholder:'字体名称',maxLength:200,value:fontValue,onChange:e=>setFontChanges({...fontChanges,[brand.id]:e.target.value})}),
      !family?button('设置字体',()=>command('font-create',{brandId:brand.id,font:fontValue.trim()}),working||!!fontPending||!fontValue.trim()):button('更新字体',()=>command('font-change',{brandId:brand.id,font:fontValue.trim(),bindingIds:fontActive.map(row=>row.id),overrideIds:fontOverrides.map(row=>row.id)}),working||!!fontPending||!fontValue.trim()||fontValue.trim()===family),
      family?button(selectedFontRow?'重新绑定所选文字':'绑定所选文字',()=>command('font-attach',{brandId:brand.id,nativeId:fontSelection.nativeId,sourceRevision:fontSelection.sourceRevision}),working||!!fontPending||!canBindFont||!fontSelection||fontSelection.font!==family||!!selectedFontRow&&selectedFontRow.brandId!==brand.id,{title:canBindFont?'绑定所选文字的原生身份':'请加载支持品牌文字身份的编辑器版本'}):null),
     family?h('p',null,'当前字体：'+family+'。字体需在目标环境可用；新绑定保留位置及文字内容，字重等样式可能按目标字体适配。旧绑定在源变化后需重新绑定。'):null,
     family&&fontState.selectionError?h('p',{role:'status'},fontState.selectionError):null,
     ...fontRows.map(row=>h('div',{className:'dcBrandControls',key:row.id},h('span',null,(sources.find(source=>source.id===row.sourceId)?.title||row.sourceId)+' · 文字 '+row.nativeId+' · '+({recorded:'跟随字体',source_changed:'旧绑定的作品已修改',font_changed:'手动字体',identity_changed:'文字身份已改变',disabled:'已停止跟随',unavailable:'文字不可用'})[row.status]),row.enabled?button('停止跟随',()=>command('font-disable',{brandId:brand.id,bindingId:row.id}),working||!!fontPending):null)),
     fontOverrides.length?h('p',null,'更新时保留 '+fontOverrides.length+' 处变更；选择文字后可重新绑定当前版本。'):null,
     fontPending?h('div',{className:'dcBrandControls'},h('span',null,'字体已保存 '+fontPending.done+'/'+fontPending.total+' 份作品'),button('继续字体更新',()=>command('font-resume',{updateId:fontPending.id}),working),button('结束未完成更新',()=>command('font-cancel',{brandId:brand.id,updateId:fontPending.id}),working)):null);
   }));
 };
}
