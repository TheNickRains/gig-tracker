const test=require('node:test'),assert=require('node:assert/strict');
const {createMailProcessor}=require('../worker/reliable-mail');
function harness(options={}){
 const row={id:'message',pipeline_entry_id:'deal',artist_id:'artist',to_email:'buyer@example.com',subject:'My subject',body:'My full body',created_at:'2026-11-01T00:00:00Z',updated_at:'v1',status:'scheduled',human:options.human!==false};
 const sends=[],patches=[],errors=[];
 const api={
  get:async q=>{
   if(q.startsWith('scheduled_messages?or='))return row.status==='uncertain'||row.status==='sending'&&options.stale?[{...row}]:[];
   if(q.startsWith('scheduled_messages?status=eq.scheduled'))return row.status==='scheduled'?[{...row}]:[];
   if(q.startsWith('scheduled_messages?status=eq.sent'))return row.status==='sent'&&!row.activity_recorded?[{...row}]:[];
   if(q.startsWith('google_connections?'))return options.disconnected?[]:[{refresh_token:'saved'}];
   if(q.startsWith('artists?'))return [{allow_auto_send:options.auto!==false}];
   if(q.startsWith('activities?'))return options.manualReply?[{id:'reply'}]:[];
   throw Error(q);
  },
  patch:async(q,p)=>{patches.push({q,p});if(options.receiptFailure&&p.status==='sent')throw Error('database offline');if(q.startsWith('scheduled_messages?')){
   if(q.includes('status=eq.scheduled')&&(row.status!=='scheduled'||!q.includes('updated_at=eq.'+row.updated_at)))return [];
   if(q.includes('status=eq.sending')&&row.status!=='sending')return [];
   Object.assign(row,p);row.updated_at+='x';return [{...row}];}return [];},
  rpc:async(name,p)=>{assert.equal(name,'claim_scheduled_message');if(row.status!=='scheduled'||row.updated_at!==p.p_version)return [];row.status='sending';row.rfc_message_id='gc-message@example.com';return [{...row}];},
  refresh:async()=>{if(options.onRefresh)options.onRefresh(row);if(options.tokenError)throw options.tokenError;return 'token';},
  search:async(_t,q)=>{if(options.searchError)throw Error('Gmail search unavailable');return q.startsWith('in:sent')?(options.foundReceipt?[{id:'receipt'}]:[]):options.liveReply?[{id:'reply'}]:[];},
  message:async()=>({labelIds:['INBOX'],internalDate:String(Date.parse('2026-11-02T00:00:00Z'))}),
  thread:async()=>({subject:'Old thread subject'}), signature:async()=>null,
  send:async(...args)=>{sends.push(args);if(options.sendError)throw options.sendError;return options.noReceipt?null:'receipt';},
  log:async()=>{if(options.logFailure)throw Error('activity write failed');},error:(...x)=>errors.push(x)
 };
 return {api,row,sends,patches,errors,run:()=>createMailProcessor(api).process()};
}
test('A02: independent workers use one atomic claim and one Gmail send',async()=>{const h=harness();await Promise.all([h.run(),h.run()]);assert.equal(h.sends.length,1);assert.equal(h.row.status,'sent');assert.equal(h.sends[0][2],'My subject');});
test('A02/A05: accepted mail with failed receipt writes cannot be sent again',async()=>{const h=harness({receiptFailure:true});await h.run();await h.run();assert.equal(h.sends.length,1);assert.equal(h.row.status,'sending');assert.equal(h.patches.filter(x=>x.p.status==='sent').length,3);});
test('A03: canceled or edited snapshot never reaches Gmail',async()=>{for(const mutate of [r=>{r.status='canceled';},r=>{r.updated_at='edited';r.body='Correction';}]){const h=harness({onRefresh:mutate});await h.run();assert.equal(h.sends.length,0);}});
test('A04: temporary token error preserves queued intention and grant',async()=>{const h=harness({tokenError:Error('503 temporary')});await h.run();assert.equal(h.row.status,'scheduled');assert.equal(h.sends.length,0);assert.equal(h.patches.some(x=>x.q.startsWith('artists?')),false);});
test('A04: revoked token marks disconnected without destroying recovery data',async()=>{const h=harness({tokenError:Object.assign(Error('reconnect'),{oauthCode:'invalid_grant'})});await h.run();assert.equal(h.row.status,'failed');assert.equal(h.row.body,'My full body');assert.ok(h.patches.some(x=>x.p.gmail_connected===false));});
test('A05: logging failure cannot turn accepted mail into failure',async()=>{const h=harness({logFailure:true});await h.run();assert.equal(h.row.status,'sent');assert.equal(h.row.gmail_message_id,'receipt');assert.equal(h.row.activity_recorded,undefined);});
test('A05: ambiguous Gmail failure is uncertain, never blindly retried',async()=>{for(const options of [{sendError:Error('connection reset')},{noReceipt:true}]){const h=harness(options);await h.run();await h.run();assert.equal(h.row.status,'uncertain');assert.equal(h.sends.length,1);}});
test('A05: deterministic receipt reconciliation records sent without resending',async()=>{const h=harness({foundReceipt:true});h.row.status='uncertain';h.row.rfc_message_id='gc-message@example.com';await h.run();assert.equal(h.row.status,'sent');assert.equal(h.sends.length,0);});
test('A08: Gmail reply cancels a follow-up before send; lookup errors postpone',async()=>{const h=harness({human:false,liveReply:true});await h.run();assert.equal(h.row.status,'canceled');assert.equal(h.sends.length,0);const f=harness({human:false,searchError:true});await f.run();assert.equal(f.row.status,'scheduled');assert.equal(f.sends.length,0);});
test('assistant sending disabled leaves a reviewable draft without Gmail calls',async()=>{const h=harness({human:false,auto:false});await h.run();assert.equal(h.row.status,'ready');assert.equal(h.sends.length,0);});
