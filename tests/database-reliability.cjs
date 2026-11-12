// Requires an isolated local PostgreSQL server, not production credentials.
// PGHOST=/private/tmp PGPORT=55440 npm run test:database
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {execFileSync,spawn}=require('node:child_process');
const bin=process.env.PG_BIN||'/opt/homebrew/opt/postgresql@15/bin';
const host=process.env.PGHOST||'/private/tmp',port=process.env.PGPORT||'55440';
if(!host.startsWith('/')&&!['localhost','127.0.0.1','::1'].includes(host))throw Error('Use an isolated LOCAL PostgreSQL server');
const db='gig_reliability_'+Date.now(),base=['-h',host,'-p',port],psql=path.join(bin,'psql');
const args=[...base,'-d',db,'-X','-q','-t','-A','-v','ON_ERROR_STOP=1'];
function run(sql){return execFileSync(psql,[...args,'-c',sql],{encoding:'utf8'}).trim();}
function file(f){return execFileSync(psql,[...args,'-f',f],{encoding:'utf8',stdio:['ignore','pipe','pipe']});}
function asyncSQL(sql){return new Promise(resolve=>{const child=spawn(psql,[...args,'-c',sql]);let out='',err='';child.stdout.on('data',x=>out+=x);child.stderr.on('data',x=>err+=x);child.on('exit',code=>resolve({code,out:out.trim(),err}));});}
(async()=>{
 execFileSync(path.join(bin,'createdb'),[...base,db]);
 try{
  file('tests/fixtures/supabase-local.sql');file('supabase/schema.sql');
  const oldArtist='b1000000-0000-4000-8000-000000000001',oldEntry='b4000000-0000-4000-8000-000000000001';
  for(const f of fs.readdirSync('supabase').filter(n=>/^migration-/.test(n)).sort()){
   if(f.startsWith('migration-040'))run(`insert into auth.users values('${oldArtist}','legacy@example.com');insert into venues(id,name)values('b2000000-0000-4000-8000-000000000001','Legacy room');insert into pipeline_entries(id,artist_id,venue_id,status)values('${oldEntry}','${oldArtist}','b2000000-0000-4000-8000-000000000001','lead');insert into scheduled_messages(artist_id,pipeline_entry_id,to_email,subject,body,send_at,status)values('${oldArtist}','${oldEntry}','buyer@example.com','Pending','Keep pending',now()+interval '1 day','scheduled'),('${oldArtist}','${oldEntry}','buyer@example.com','Unknown','Keep uncertain',now(),'failed'),('${oldArtist}','${oldEntry}','buyer@example.com','Due','Keep due',now(),'scheduled');`);
   file('supabase/'+f);
  }
  assert.deepEqual(JSON.parse(run(`select json_agg(status order by status) from scheduled_messages where artist_id='${oldArtist}'`)),['ready','uncertain','uncertain']);
  assert.equal(run(`select count(*) from scheduled_messages where body like 'Keep %'`),'3');
  run(`update scheduled_messages set status='canceled' where artist_id='${oldArtist}';delete from auth.users where id='${oldArtist}';`);
  console.log('Upgrade preserves legacy bodies and pauses unverified attempts.');
  file('tests/database-reliability.sql');console.log('All ownership, state transition, calendar and reminder SQL checks passed.');
  const artist='a1000000-0000-4000-8000-000000000001',entry='a4000000-0000-4000-8000-000000000001',person='a3000000-0000-4000-8000-000000000001',venue='a2000000-0000-4000-8000-000000000001';
  run(`insert into auth.users values('${artist}','test@example.com');insert into venues(id,name)values('${venue}','Fixture');insert into people(id,email)values('${person}','buyer@example.com');insert into pipeline_entries(id,artist_id,venue_id,person_id,status)values('${entry}','${artist}','${venue}','${person}','lead');`);
  const auth=`begin;set local role authenticated;select set_config('request.jwt.claim.sub','${artist}',true);`;
  const queue=id=>`select (queue_message('${id}','${entry}','buyer@example.com','Subject','Body',now(),true)).id;`;
  const first='a5000000-0000-4000-8000-000000000001',second='a5000000-0000-4000-8000-000000000002';
  const queued=await Promise.all([asyncSQL(auth+queue(first)+'select pg_sleep(0.15);commit;'),asyncSQL(auth+queue(second)+'commit;')]);
  assert.equal(queued.filter(x=>x.code===0).length,1);assert.match(queued.find(x=>x.code!==0).err,/already waiting/);assert.equal(run('select count(*) from scheduled_messages'),'1');
  console.log('Concurrent queue requests: one message, competing request refused.');
  const m=JSON.parse(run('select row_to_json(x) from (select id,updated_at from scheduled_messages limit 1)x'));
  const claim=`begin;set local role service_role;select count(*) from claim_scheduled_message('${m.id}','${m.updated_at}');select pg_sleep(0.15);commit;`;
  const claims=await Promise.all([asyncSQL(claim),asyncSQL(claim)]);assert.ok(claims.every(x=>x.code===0),JSON.stringify(claims));assert.deepEqual(claims.map(x=>Number(x.out)).sort(),[0,1]);
  console.log('Concurrent worker claims: exactly one winner.');
 }finally{execFileSync(path.join(bin,'dropdb'),[...base,db]);}
})().catch(e=>{console.error(e.stderr?.toString()||e);process.exitCode=1;});
