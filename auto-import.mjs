import crypto from 'node:crypto';
import {collectSource,decrypt} from './source-manager.mjs';
import {tmdbLookup} from './admin-extras.mjs';
let working=false;
const kinds=['live','movie','series'];
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function hash(x){return crypto.createHash('sha256').update(x).digest('hex')}
function normalizedTitle(t){return String(t||'').toLowerCase().normalize('NFKC').replace(/\((19|20)\d{2}\)/g,' ').replace(/[^\p{L}\p{N}]/gu,' ').replace(/\s+/g,' ').trim()}
export async function enrichItem(item,tmdbKey,lookup=tmdbLookup){
 if(!tmdbKey||!['movie','series'].includes(item.kind))return item;
 try{
  const title=String(item.title).replace(/\((?:19|20)\d{2}\)/g,'').trim();
  const matches=await lookup(title,item.kind,tmdbKey);
  const candidate=matches.find(x=>normalizedTitle(x.title)===normalizedTitle(title)&&(!item.release_year||!x.release_year||Math.abs(x.release_year-item.release_year)<=1));
  if(!candidate)return item;
  return {...item,tmdb_id:candidate.tmdb_id,description:candidate.description||'',poster_url:candidate.poster_url||item.poster_url,
    release_year:candidate.release_year||item.release_year,dedupe_key:hash('tmdb:'+item.kind+':'+candidate.tmdb_id)};
 }catch{return item}
}
export function startAutoImport({url,publishableKey}){
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!serviceKey||!process.env.AKKAD_SOURCE_ENCRYPTION_KEY||!url)return {enabled:false,reason:'server role or encryption key missing'};
 async function db(table,query='',method='GET',body){
  const response=await fetch(url+'/rest/v1/akkad_'+table+query,{method,
   headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'content-type':'application/json',
    ...(method!=='GET'?{Prefer:method==='POST'?'resolution=ignore-duplicates,return=representation':'return=representation'}:{})},
   body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(13000)});
  const raw=await response.text();let result;try{result=raw?JSON.parse(raw):[]}catch{result=[]}
  if(!response.ok)throw new Error('Database '+table+' HTTP '+response.status+' '+String(result?.message||'').slice(0,120));
  return result;
 }
 async function nextBatch(source,credentials,kind,tmdbKey){
  const history=await db('source_sync_jobs','?select=next_offset,available_count&source_id=eq.'+source.id+'&kind=eq.'+kind+'&status=eq.success&order=started_at.desc&limit=1');
  let offset=Number(history?.[0]?.next_offset||0);
  if(history.length&&offset>=Number(history[0].available_count))offset=0;
  const created=await db('source_sync_jobs','', 'POST',{source_id:source.id,kind,requested_limit:50,requested_offset:offset,status:'running'});
  const job=created[0];if(!job?.id)return;
  let imported=0;
  try{
   const batch=await collectSource(source,credentials,kind,50,process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',
     {allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true',offset});
   const unique=[...new Map(batch.items.map(x=>[x.external_id,x])).values()];
   let prepared=unique;
   if(tmdbKey&&kind!=='live'){
    const enriched=[];
    for(let i=0;i<prepared.length;i+=4){
      const chunk=prepared.slice(i,i+4);
      enriched.push(...await Promise.all(chunk.map(x=>enrichItem(x,tmdbKey))));
      await delay(220);
    }
    prepared=enriched;
   }
   if(prepared.length){
    const now=new Date().toISOString();
    const distinct=[...new Map(prepared.map(x=>[x.dedupe_key,x])).values()];
    await db('catalog','?on_conflict=dedupe_key','POST',distinct.map(x=>({
      source_id:source.id,dedupe_key:x.dedupe_key,title:x.title,kind:x.kind,
      description:x.description||'',category:x.category,tmdb_id:x.tmdb_id,
      poster_url:x.poster_url,release_year:x.release_year,
      published:Boolean(source.auto_publish),last_synced_at:now
    })));
    const catalog=await db('catalog','?select=id,dedupe_key,source_id&dedupe_key=in.('+distinct.map(x=>x.dedupe_key).join(',')+')&limit=150');
    const map=new Map(catalog.map(x=>[x.dedupe_key,x.id]));
    const linked=prepared.filter(x=>map.has(x.dedupe_key)).map(x=>({
      source_id:source.id,catalog_id:map.get(x.dedupe_key),kind:x.kind,category:x.category,
      external_id:x.external_id,last_seen_at:now
    }));
    if(linked.length){
      const response=await fetch(url+'/rest/v1/akkad_source_items?on_conflict=source_id,kind,external_id',{
       method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'content-type':'application/json',
        Prefer:'resolution=merge-duplicates,return=minimal'},body:JSON.stringify(linked),signal:AbortSignal.timeout(12000)});
      if(!response.ok)throw new Error('Failed to link source items');
      imported=linked.length;
    }
    if(source.auto_publish){
      await db('catalog','?source_id=eq.'+source.id+'&dedupe_key=in.('+distinct.map(x=>x.dedupe_key).join(',')+')','PATCH',{published:true});
    }
   }
   const next=Math.min(batch.total,offset+50);
   await db('source_sync_jobs','?id=eq.'+job.id,'PATCH',{
     status:'success',imported_count:imported,available_count:batch.total,
     next_offset:next,skipped_count:batch.invalid,completed_at:new Date().toISOString()
   });
  }catch(e){
   await db('source_sync_jobs','?id=eq.'+job.id,'PATCH',{status:'failed',error_summary:String(e.message).slice(0,180),completed_at:new Date().toISOString()}).catch(()=>{});
   throw e;
  }
 }
 async function cycle(){
  if(working)return;working=true;
  try{
   const sources=await db('sources','?select=*&enabled=eq.true&license_confirmed=eq.true&auto_import=eq.true&order=auto_last_run_at.asc.nullsfirst&limit=3');
   const cfg=await db('config','?select=*&setting_key=eq.tmdb_api&limit=1').catch(()=>[]);
   let tmdbKey;try{tmdbKey=cfg?.length?decrypt(cfg[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY).key:null}catch{}
   for(const s of sources){
    const diff=Date.now()-new Date(s.auto_last_run_at||0).getTime();
    if(diff<Number(s.auto_interval_minutes||60)*60000)continue;
    try{
     const secret=await db('source_credentials','?select=*&source_id=eq.'+s.id);
     const credentials=decrypt(secret[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
     for(const kind of kinds)await nextBatch(s,credentials,kind,tmdbKey);
     const items=await db('source_items','?select=kind&source_id=eq.'+s.id+'&limit=10000');
     await db('sources','?id=eq.'+s.id,'PATCH',{
      auto_last_run_at:new Date().toISOString(),auto_last_error:null,
      live_count:items.filter(x=>x.kind==='live').length,movie_count:items.filter(x=>x.kind==='movie').length,
      series_count:items.filter(x=>x.kind==='series').length
     });
    }catch(e){
     console.error('AKKAD auto-import',s.id,String(e.message).slice(0,160));
     await db('sources','?id=eq.'+s.id,'PATCH',{auto_last_run_at:new Date().toISOString(),auto_last_error:String(e.message).slice(0,160)}).catch(()=>{});
    }
   }
  }catch(e){console.error('AKKAD auto-import schedule',e.message)}
  finally{working=false}
 }
 const initial=setTimeout(()=>cycle(),30000);initial.unref?.();
 const timer=setInterval(cycle,15*60*1000);timer.unref?.();
 return {enabled:true};
}
