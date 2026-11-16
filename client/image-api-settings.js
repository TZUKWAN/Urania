const PRESETS={
 gemini:{name:'Gemini 图片协议',url:'https://generativelanguage.googleapis.com/v1beta'},
 openai:{name:'OpenAI / GPT Image 兼容协议',url:'https://api.openai.com/v1'},
 openrouter:{name:'OpenRouter 图片协议',url:'https://openrouter.ai/api/v1'},
 venice:{name:'Venice 图片协议',url:'https://api.venice.ai/api/v1'}
};
const CSS='.dcImageApiBody{overflow:auto;padding:18px;flex:1}.dcImageApiForm{max-width:720px;display:grid;gap:16px}.dcImageApiForm label{display:grid;gap:7px;font-size:13px}.dcImageApiForm input,.dcImageApiForm select{box-sizing:border-box;width:100%;min-height:36px}.dcImageApiForm small,.dcImageApiForm p{color:var(--dc-muted);font-size:12px;line-height:1.7;margin:0}.dcImageApiActions{display:flex;flex-wrap:wrap;gap:10px}';

export function createImageApiSettings(React){
 const h=React.createElement;
 return function ImageApiSettings({call,onSaved,onBack,onClose}){
  const [snapshot,setSnapshot]=React.useState(null),[form,setForm]=React.useState(null),[apiKey,setApiKey]=React.useState(''),[busy,setBusy]=React.useState(false),[error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[clearArmed,setClearArmed]=React.useState(false);
  const alive=React.useRef(true),lock=React.useRef(false);
  const apply=data=>{setSnapshot(data);setForm(data.available?data.config:null);setApiKey('');setClearArmed(false);};
  React.useEffect(()=>{alive.current=true;let active=true;call('api-settings').then(data=>{if(active)apply(data);}).catch(error=>{if(active)setError(error.message);});return()=>{active=false;alive.current=false;};},[]);
  const run=task=>async()=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');setNotice('');try{await task();}catch(error){if(alive.current)setError(error.message||'配置请求未确认，请重新读取核对。');}finally{lock.current=false;if(alive.current)setBusy(false);}};
  const reload=async()=>{const data=await call('api-settings');if(alive.current){apply(data);setNotice('已重新读取保存的配置。');}};
  const save=async(clear=false)=>{
   const config=clear?{revision:form.revision}:{revision:form.revision,mode:form.mode,protocol:form.protocol,baseURL:form.baseURL,model:form.model,...(apiKey?{apiKey}:{})};
   setApiKey('');
   const data=await call(clear?'clear-api-settings':'save-api-settings',{config});
   if(alive.current){apply(data);onSaved();setNotice((clear?'独立配置已清除，已切回复用 DSH 连接。':form.mode==='dedicated'?'独立生图 API 配置已保存。':'已保存为复用 DSH 连接。')+(data.warnings?.length?' '+data.warnings.join('；'):'')+' 保存未调用生图服务。');}
  };
  const update=(field,value)=>{setForm(current=>({...current,[field]:value}));setNotice('');setClearArmed(false);};
  const endpointChanged=form&&snapshot?.config&&(form.baseURL.trim().replace(/\/$/,'')!==snapshot.config.baseURL||form.protocol!==snapshot.config.protocol);
  return h('section',{className:'dcStudioImageWorkspace',role:'region','aria-label':'生图 API 设置'},
   h('style',null,CSS),
   h('div',{className:'dcStudioImageHeader'},h('strong',null,'生图 API 设置'),h('span',null,'单独配置图片生成服务'),h('button',{className:'dcBtn',disabled:busy,onClick:onBack},'返回图片'),h('button',{className:'dcBtn',disabled:busy,onClick:onClose},'返回设计')),
   error?h('div',{className:'dcNativeNotice',role:'alert'},error):null,
   notice?h('div',{className:'dcNativeNotice',role:'status'},notice):null,
   h('div',{className:'dcImageApiBody'},
    !snapshot&&!error?h('p',{role:'status'},'正在读取生图配置…'):null,
    snapshot?.available===false?h('p',{role:'alert'},snapshot.error||'DSH 配置存储尚未就绪。'):null,
    form?h('form',{className:'dcImageApiForm',autoComplete:'off',onSubmit:event=>{event.preventDefault();run(()=>save())();}},
     h('label',null,'连接方式',h('select',{value:form.mode,disabled:busy,onChange:event=>update('mode',event.target.value)},h('option',{value:'dedicated'},'使用独立生图 API'),h('option',{value:'dsh'},'复用 DSH 已有连接'))),
     h('p',null,'这项配置用于 DesignCraft 图片生成与重绘。聊天模型配置保持独立。'),
     form.mode==='dedicated'?h(React.Fragment,null,
      h('label',null,'接口协议',h('select',{value:form.protocol,disabled:busy,onChange:event=>{const protocol=event.target.value;setForm(current=>({...current,protocol,baseURL:PRESETS[protocol].url,model:''}));setApiKey('');setNotice('');setClearArmed(false);}},...Object.entries(PRESETS).map(([id,item])=>h('option',{key:id,value:id},item.name)))),
      h('label',null,'API 基础地址',h('input',{className:'dcInput',type:'url',required:true,value:form.baseURL,disabled:busy,spellCheck:false,placeholder:PRESETS[form.protocol]?.url,onChange:event=>update('baseURL',event.target.value)}),h('small',null,'填写服务要求的基础地址（通常含 /v1 或 /v1beta），不要追加 /images/generations 或密钥。')),
      h('label',null,'API 密钥',h('input',{className:'dcInput',type:'password',value:apiKey,disabled:busy||!snapshot.credential.writable,autoComplete:'new-password',spellCheck:false,maxLength:8192,placeholder:snapshot.credential.configured?'已保存；留空保留原密钥':'填写独立生图服务的 API 密钥',onChange:event=>setApiKey(event.target.value)}),h('small',null,snapshot.credential.configured?'当前有已保存密钥，界面不回显。':'尚未保存独立生图密钥。'),!snapshot.credential.writable?h('small',null,'DSH 凭据服务当前不可写，仍可保留已保存密钥。'):null,endpointChanged&&snapshot.credential.configured?h('small',null,'服务地址或协议已改变，请重新填写密钥。'):null),
      ['gemini','openai'].includes(form.protocol)?h('label',null,'模型 ID（可选）',h('input',{className:'dcInput',value:form.model,disabled:busy,spellCheck:false,maxLength:200,placeholder:'留空时从服务读取模型目录',onChange:event=>update('model',event.target.value)}),h('small',null,'填写服务提供的图片模型 ID 后，直接使用该配置；模型和账号权限尚需实际调用确认。')):h('p',null,'该协议的模型选项从服务实际目录读取。'),
      h('p',null,'密钥由 DSH 凭据服务保存，不写入作品、项目导出包或浏览器本地存储。实际生成可能产生服务费用。')
     ):h('p',null,'沿用 DSH 中已有的图片连接；独立配置和已保存密钥会保留，方便之后切换。'),
     h('div',{className:'dcImageApiActions'},h('button',{className:'dcBtn dcPrimary',type:'submit',disabled:busy||form.mode==='dedicated'&&(!apiKey&&!snapshot.credential.configured||endpointChanged&&snapshot.credential.configured&&!apiKey)},'保存配置'),h('button',{className:'dcBtn',type:'button',disabled:busy,onClick:run(reload)},'重新读取'),h('button',{className:'dcBtn',type:'button',disabled:busy||form.revision==='none',onClick:()=>setClearArmed(value=>!value)},'清除独立配置')),
     clearArmed?h('div',{className:'dcNativeNotice',role:'status'},h('span',null,'清除独立配置及其密钥，然后复用 DSH 连接。'),h('button',{className:'dcBtn',type:'button',disabled:busy,onClick:run(()=>save(true))},'确认清除'),h('button',{className:'dcBtn',type:'button',disabled:busy,onClick:()=>setClearArmed(false)},'取消')):null
    ):error||snapshot?.available===false?h('button',{className:'dcBtn',disabled:busy,onClick:run(reload)},'重新读取'):null
   )
  );
 };
}
