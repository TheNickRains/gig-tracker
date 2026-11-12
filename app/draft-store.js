/* Account-scoped recovery plus optimistic cloud versions. No message is sent here. */
(function(root){
  function createDraftStore({storage,key,id,save,onError}) {
    let records={};
    try { records=JSON.parse(storage.getItem(key)||'{}'); } catch(_) {}
    const inflight=new Map();
    function persist(){ try{storage.setItem(key,JSON.stringify(records));}catch(e){onError(e);} }
    function get(uuid){return records[uuid] || (records[uuid]={request_id:id(),version:null,body:'',subject:'',angle:'',ai_draft:null,revision:0,dirty:false});}
    function update(uuid,patch){const r=get(uuid);Object.assign(r,patch);r.revision++;r.dirty=true;persist();return r;}
    function merge(rows){
      for(const remote of rows){
        const local=records[remote.pipeline_entry_id];
        if(local && local.request_id===remote.request_id && local.version!==null && remote.version<local.version)continue;
        if(!local || !local.dirty){records[remote.pipeline_entry_id]={...remote,revision:(local?.revision||0)+1,dirty:false};}
        else if(local.version!==remote.version){local.conflict=remote;}
      }
      persist();
    }
    function resolve(uuid,keepLocal){const r=get(uuid), remote=r.conflict;if(!remote)return;
      records[uuid]=keepLocal?{...r,request_id:remote.request_id,version:remote.version,conflict:null,dirty:true}:
        {...remote,revision:r.revision+1,dirty:false};persist();}
    async function flush(uuid){
      if(inflight.has(uuid))return inflight.get(uuid);
      const work=(async()=>{
        let r=get(uuid);
        while(r.dirty){
          if(r.conflict)throw new Error('Draft changed in another browser. Choose which version to keep.');
          const snapshot={...r}, remote=await save(uuid,snapshot);
          r=get(uuid);r.version=remote.version;r.request_id=remote.request_id;
          if(r.conflict && r.conflict.version<=remote.version)delete r.conflict;
          if(r.revision===snapshot.revision)r.dirty=false;
          persist();
        }
        return {...r};
      })();
      inflight.set(uuid,work);
      try{return await work;}finally{inflight.delete(uuid);}
    }
    function queued(uuid,revision){const r=get(uuid);
      if(r.revision===revision)delete records[uuid];
      else records[uuid]={...r,request_id:id(),version:null,conflict:null,dirty:true};
      persist();
    }
    function fresh(uuid,patch){records[uuid]={request_id:id(),version:null,body:'',subject:'',angle:'',ai_draft:null,revision:(records[uuid]?.revision||0)+1,dirty:true,...patch};persist();return records[uuid];}
    return {get,update,merge,resolve,flush,queued,fresh,all:()=>records};
  }
  if(typeof module==='object')module.exports={createDraftStore};else root.createDraftStore=createDraftStore;
})(typeof window==='object'?window:globalThis);
