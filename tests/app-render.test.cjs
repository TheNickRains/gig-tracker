const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {app}=require('./helpers.cjs');
const {createDraftStore}=require('../app/draft-store');
function appHarness(){
 const elements=new Map(),storage=new Map();
 function el(id){if(!elements.has(id))elements.set(id,{id,innerHTML:'',value:'',style:{},dataset:{},classList:{add(){},remove(){},toggle(){},contains(){return false;}},setAttribute(){},querySelector(){return null;},querySelectorAll(){return [];}});return elements.get(id);}
 const sb={auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}},from(){const q=new Proxy({then(resolve){return Promise.resolve({data:[]}).then(resolve);}},{get(o,k){return k in o?o[k]:()=>q;}});return q;}};
 const c=vm.createContext({console,URL,URLSearchParams,Date,crypto:require('node:crypto'),createDraftStore,
  GIG_CONFIG:{SUPABASE_URL:'https://example.invalid',SUPABASE_ANON_KEY:'fake'},supabase:{createClient:()=>sb},
  document:{getElementById:el,querySelector:()=>null,querySelectorAll:()=>[],addEventListener(){},documentElement:el('root')},
  localStorage:{getItem:k=>storage.get(k),setItem:(k,v)=>storage.set(k,v)},sessionStorage:{getItem:()=>null},
  location:{hash:'#home',origin:'https://example.invalid'},navigator:{},setTimeout:()=>1,clearTimeout(){},setInterval(){},addEventListener(){},scrollTo(){},innerWidth:1000
 });c.window=c;
 for(const m of app.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))vm.runInContext(m[1],c);
 c.ME='artist';c.initDrafts();c.pipeline=[{id:c.dealHandle('A'),uuid:'A',venue:'Room <img src=x onerror="oops()">',vtype:'Bar',city:'Austin',state:'TX',pay:'$150',s:'lead',t:'soft',contact:'Booker',email:'a@example.com',activity:[],contactsAll:[],dealVenues:[]}];
 return {c,el};
}
test('full app renders drafts and every outbox state without runtime errors',()=>{const {c,el}=appHarness();c.openDetail(0);assert.match(el('detail-container').innerHTML,/updateDraft/);assert.match(el('detail-container').innerHTML,/data-recipient="a@example.com"/);assert.ok(!el('detail-container').innerHTML.includes('<img src=x'));
 for(const status of ['scheduled','ready','sending','uncertain','failed','canceled']){c.pipeline[0].sched={id:'m',status,body:'Full saved text',subject:'Saved subject',to_email:'old@example.com',send_at:new Date().toISOString(),rfc_message_id:'id@example.com'};c.openDetail(0);const html=el('detail-container').innerHTML;assert.ok(html.includes('Full saved text'),status);assert.ok(html.includes('old@example.com'),status);if(['sending','uncertain'].includes(status))assert.ok(!html.includes('onclick="editSched'),status);}
 c.pipeline[0].s='dead';c.openDetail(0);assert.ok(el('detail-container').innerHTML.includes('Full saved text'));
});
test('home surfaces failed mail and archived venue detail remains reachable',()=>{const {c,el}=appHarness();c.pipeline[0].sched={status:'failed',cancel_reason:'Reconnect Gmail'};c.actsReady=true;c.schedReady=true;c.renderHome();assert.match(el('war-needs').innerHTML,/Email was not sent/);assert.match(el('war-needs').innerHTML,/Reconnect Gmail/);
 c.venues=[{id:'venue',name:'Archived room',city:'Austin',state:'TX',archived:true}];c.openVenueDetail('venue');assert.match(el('venue-container').innerHTML,/Restore archived venue/);
});
