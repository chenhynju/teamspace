const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ts=require('typescript');
function load(file,deps={}) {
  const exports={};
  const source=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,
    {exports,console,require:id=>deps[id]??require(id)});
  return exports;
}
const message=(id)=>({id,content:id,createdAt:'2026-10-20T00:00:00.000Z'});
test('HTTP and realtime copies render once in either arrival order',()=>{
  for(const order of [['http','ws'],['ws','http']]) {
    const store=load('src/store/im.ts').useImStore;
    store.getState().setCurrentConversationId('A');
    for(const source of order) store.getState().appendMessage({...message('one'),source},'A');
    assert.equal(store.getState().messages.length,1);
  }
});
test('late history retains live delivery; switching conversations rejects stale sends',()=>{
  const store=load('src/store/im.ts').useImStore;
  store.getState().setCurrentConversationId('A');
  store.getState().appendMessage(message('2'),'A');
  store.getState().setMessages([message('1')],'A');
  assert.deepEqual(Array.from(store.getState().messages,m=>m.id),['1','2']);
  store.getState().setCurrentConversationId('B');
  store.getState().appendMessage(message('late-A'),'A');
  store.getState().setMessages([message('history-A')],'A');
  assert.equal(store.getState().messages.length,0);
});
test('rapid Enter sends once; IME confirmation does not send',async()=>{
  let pending,posts=0;
  const api={post:()=>{posts++;return new Promise(resolve=>pending=resolve);}};
  const jsx=(type,props)=>({type,props});
  const Component=load('src/components/im/MessageComposer.tsx',{
    react:{useState:initial=>[initial===''?'hello':initial,()=>{}],useRef:initial=>({current:initial})},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    '@/lib/api':{api},'@/store/im':{useImStore:selector=>selector({appendMessage:()=>{}})},
    '@/store/auth':{useAuthStore:{getState:()=>({currentOrgId:'org'})}},
  }).default;
  const tree=Component({conversationId:'A'});
  function find(node,type){if(!node||typeof node!=='object')return; if(node.type===type)return node;for(const child of [node.props?.children].flat(Infinity)){const got=find(child,type);if(got)return got;}}
  const textarea=find(tree,'textarea');
  const enter=composing=>({key:'Enter',shiftKey:false,nativeEvent:{isComposing:composing},preventDefault(){}});
  textarea.props.onKeyDown(enter(true));assert.equal(posts,0);
  textarea.props.onKeyDown(enter(false));textarea.props.onKeyDown(enter(false));
  assert.equal(posts,1);
  pending({data:message('sent')});await new Promise(resolve=>setImmediate(resolve));
});
test('opening a conversation from a deep link acknowledges history and clears unread',async()=>{
  const store=load('src/store/im.ts').useImStore;
  store.setState({currentConversationId:'A',conversations:[{id:'A',unreadCount:1}]});
  const reads=[];
  const jsx=(type,props)=>({type,props});
  const Window=load('src/components/im/ChatWindow.tsx',{
    react:{useEffect:fn=>fn(),useRef:()=>({current:null})},
    'react/jsx-runtime':{jsx,jsxs:jsx},
    '@/store/im':{useImStore:selector=>selector(store.getState())},
    '@/store/auth':{useAuthStore:selector=>selector({currentOrgId:'org'})},
    '@/lib/api':{api:{get:async()=>({data:[message('latest')]}),post:async(url,body)=>reads.push({url,body})}},
    './MessageBubble':{default:()=>null},'./MessageComposer':{default:()=>null},
  }).default;
  Window();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(reads[0].body.lastReadMessageId,'latest');
  assert.equal(store.getState().conversations[0].unreadCount,0);
});
