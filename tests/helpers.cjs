const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../app/index.html'),'utf8'),worker=fs.readFileSync(path.join(__dirname,'../worker/index.js'),'utf8');
function cut(source,begin,end){const a=source.indexOf(begin),b=source.indexOf(end,a+begin.length);assert.ok(a>=0&&b>a,begin);return source.slice(a,b);}
const flush=()=>new Promise(r=>setImmediate(r));
module.exports={app,worker,cut,flush};
