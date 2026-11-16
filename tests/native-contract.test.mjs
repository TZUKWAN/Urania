// Schema/policy inputs only. Real native/WASM/edit/save evidence is a separate gate.
import test from 'node:test';
import assert from 'node:assert/strict';
import {SOURCE_FORMATS,VECTOR_CONTRACT,PHOTO_CONTRACT,DECK_CONTRACT,validateNativeContext,validateNativeIdentity,nativeBase,matchesNativeBase,selectedObjectIds,sameNativeDocument} from '../client/native-contract.js';

const input=()=>({engine:'vectorcraft',contextProtocol:2,contextSequence:19,uid:'18446744073709551614',revision:'9007199254740993',selection:['9007199254740995'],nativeSelection:{kind:'vectorcraft',data:{objects:['9007199254740995'],anchors:{'9007199254740995':[[0,1]]},segments:{},guides:[2],new_art:[]}},selectionStamp:'opaque canonical native context'});
test('exact native identity and engine-owned selection produce an unchanged execution fence',()=>{
 const document=input(),before=JSON.stringify(document),base=nativeBase(document);
 assert.equal(validateNativeContext(document,'vectorcraft'),document);assert.equal(base.uid,'18446744073709551614');assert.equal(base.revision,'9007199254740993');assert.deepEqual(base.selection,['9007199254740995']);assert.equal(matchesNativeBase(document,base,'vectorcraft'),true);assert.equal(JSON.stringify(document),before);
 assert.equal(Object.hasOwn(base,'contextSequence'),false,'A read sequence orders replies; unchanged native selection remains executable after another read');
});
test('anchor/page stamp, wrong engine, rounded identity and different objects cannot match',()=>{
 const document=input(),base=nativeBase(document);
 assert.equal(matchesNativeBase(document,{...base,selectionStamp:'changed native anchor/page'},'vectorcraft'),false);
 assert.equal(matchesNativeBase(document,{...base,engine:'photocraft'},'vectorcraft'),false);
 assert.equal(matchesNativeBase(document,{...base,uid:Number(base.uid)},'vectorcraft'),false);
 assert.equal(matchesNativeBase(document,{...base,selection:['9007199254740994']},'vectorcraft'),false);
 assert.throws(()=>validateNativeContext({...document,nativeSelection:{kind:'photocraft',data:document.nativeSelection.data}},'vectorcraft'));
 assert.throws(()=>validateNativeContext({...document,selection:[2]},'vectorcraft'));
});
test('file-format knowledge never implicitly advertises Photo or Deck as working live editors',()=>{
 assert.equal(SOURCE_FORMATS.photocraft,'pcraft');assert.equal(SOURCE_FORMATS.deckcraft,'deckcraft');assert.equal(VECTOR_CONTRACT.engine,'vectorcraft');assert.equal(VECTOR_CONTRACT.contextProtocol,2);
 assert.deepEqual(selectedObjectIds({engine:'photocraft',selection:{mask:'native opaque data'}}),[]);
 assert.deepEqual(selectedObjectIds(input()),['9007199254740995']);
});
test('identity validation accepts exact old safe values but rejects noncanonical large numbers',()=>{
 assert.equal(validateNativeIdentity({uid:1,revision:7}).uid,1);
 assert.throws(()=>validateNativeIdentity({uid:9007199254740993,revision:1}));
 assert.throws(()=>validateNativeContext({...input(),contextProtocol:1},'vectorcraft'));
 assert.throws(()=>validateNativeContext({...input(),selectionStamp:''},'vectorcraft'));
});
test('Photo schema keeps actual native layer identities and a source-backed raster reference distinct',()=>{
 // Deliberately constructed schema input, not claimed Photo engine output or alpha pixels.
 const revision='9007199254740995',document={engine:'photocraft',contextProtocol:2,contextSequence:7,uid:1,revision,nativeDocumentId:'18446744073709551614',identityKind:'native-active-document-generation',selectionStamp:'native opaque photo fence',nativeSelection:{kind:'photocraft',data:{documentId:'18446744073709551614',activeGeneration:1,selectedLayers:['9007199254740993'],rasterSelection:{kind:'native-coverage-surface',nativeRole:'document.selection',uid:1,revision,defaultPixel:[0]}}}};
 assert.equal(validateNativeContext(document,'photocraft'),document);assert.equal(PHOTO_CONTRACT.sourceFormat,'pcraft');
 const base=nativeBase(document);assert.equal(Object.hasOwn(base,'selection'),false);assert.deepEqual(selectedObjectIds(document),['9007199254740993']);
 assert.equal(sameNativeDocument(document,{...document,nativeDocumentId:'18446744073709551613'}),false);
 const stale=structuredClone(document);stale.nativeSelection.data.rasterSelection.revision='9007199254740994';assert.throws(()=>validateNativeContext(stale,'photocraft'));
});

const deckInput=()=>({engine:'deckcraft',contextProtocol:2,contextSequence:8,uid:'9007199254740993',revision:7,identityKind:'native-document-instance-uid',selectionStamp:'complete native Deck page/selection/tool input',objectIds:[42],slideCount:2,slides:[{id:11,index:0},{id:29,index:1}],nativeSelection:{kind:'deckcraft',data:{selection:{slide:1,slides:[29],shapes:[42],text:null,cells:[42,[0,0],[1,2]],target:{kind:'slides'}}}},page:{target:{kind:'slides'},nativePage:{kind:'slide',id:29,index:1},width:960,height:540}});
test('Deck schema keeps native slides/text/cells/target, actual u32 shapes and exact runtime UID',()=>{
 const d=deckInput(),original=JSON.stringify(d);assert.equal(DECK_CONTRACT.sourceFormat,'deckcraft');assert.equal(DECK_CONTRACT.objectIdBits,32);
 assert.equal(validateNativeContext(d,'deckcraft'),d);assert.deepEqual(selectedObjectIds(d),[42]);assert.equal(nativeBase(d).uid,'9007199254740993');assert.equal(Object.hasOwn(nativeBase(d),'selection'),false);assert.equal(JSON.stringify(d),original);
 const other=structuredClone(d);other.page.nativePage.id=11;assert.throws(()=>validateNativeContext(other,'deckcraft'));
 const wide=structuredClone(d);wide.objectIds=[4294967296];wide.nativeSelection.data.selection.shapes=[4294967296];assert.throws(()=>validateNativeContext(wide,'deckcraft'));
});
test('Deck notes and master targets do not become a stale slide-object list',()=>{
 const d=deckInput();d.nativeSelection.data.selection.text={notes:true,anchor:[0,0],caret:[0,3]};d.objectIds=[];d.page.nativePage.kind='slideNotes';assert.equal(validateNativeContext(d,'deckcraft'),d);assert.deepEqual(selectedObjectIds(d),[]);
 d.objectIds=[42];assert.throws(()=>validateNativeContext(d,'deckcraft'));
 const master=deckInput();master.nativeSelection.data.selection.target={kind:'layout',master:0,layout:1};master.page={target:{kind:'layout',master:0,layout:1},nativePage:{kind:'layout',masterId:3,id:4,index:1},width:960,height:540};assert.equal(validateNativeContext(master,'deckcraft'),master);
 master.page.target.layout=0;assert.throws(()=>validateNativeContext(master,'deckcraft'));
});
