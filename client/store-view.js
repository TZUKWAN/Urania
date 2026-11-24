/** Keep layout and SDK slot subscribers stable while other workspaces update. */
export function storeView(store,select) {
 let observed,snapshot;
 return () => {
  const state=store.get();
  if(state!==observed||snapshot===undefined){
   const next=select(state);
   const keys=Object.keys(next);
   if(snapshot===undefined||keys.length!==Object.keys(snapshot).length||keys.some(key=>!Object.hasOwn(snapshot,key)||!Object.is(next[key],snapshot[key])))snapshot=next;
   observed=state;
  }
  return snapshot;
 };
}

/** UI-only identity for native observations. The controller/store keep every
 * actual ordering counter; it is not displayed or used by these renderers. */
export function nativeUiView(){
 let observedDocument,document,content,snapshot;
 return native=>{
  if(!native){observedDocument=document=content=snapshot=undefined;return native;}
  if(native.document!==observedDocument){
   const actual=native.document;
   const {contextSequence,...visible}=actual||{};
   const next=actual==null?actual:JSON.stringify(visible);
   if(next!==content){document=actual;content=next;}
   observedDocument=actual;
  }
  const next={...native,document},keys=Object.keys(next);
  if(!snapshot||keys.length!==Object.keys(snapshot).length||keys.some(key=>!Object.hasOwn(snapshot,key)||!Object.is(next[key],snapshot[key])))snapshot=next;
  return snapshot;
 };
}
