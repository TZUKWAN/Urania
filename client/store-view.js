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
