import { collectSource, decrypt, getSeriesInfo } from './source-manager.mjs';
import { issueTicket } from './media-gateway.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const codePattern=/^[A-Z0-9]{2,12}$/;
const number=/^\d{1,15}$/;
const kindSet=new Set(['live','movie','series']);
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const cache=new Map();
const queryEncode=encodeURIComponent;
const isActive=s=>s?.enabled===true&&s.license_confirmed===true&&s.last_check_status==='ok'&&
 (!s.provider_expires_at||new Date(s.provider_expires_at).getTime()>Date.now());
const publicSource=s=>({id:s.id,name:s.name,kind:s.kind,live_count:s.live_count||0,movie_count:s.movie_count||0,series_count:s.series_count||0});
const cleanExt=x=>['mp4','mkv','avi','ts','m3u8'].includes(String(x||'').toLowerCase())?String(x).toLowerCase():null;

export async function instantCatalog({req,res,p,url,auth,apiRequest,json}){
 if(!p.startsWith('/api/instant/'))return false;
 if(req.method!=='GET')throw failure('الطريقة غير مدعومة',405);
 const match=/^\/api\/instant\/(free\/([A-Z0-9]{2,12})|vip)\/(sources|catalog|watch|episodes)$/.exec(p);
 if(!match)throw failure('المسار غير معروف',404);
 const isFree=Boolean(match[2]),scope=match[2]||'vip',operation=match[3];
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key||!process.env.AKKAD_SOURCE_ENCRYPTION_KEY)throw failure('مفاتيح المصادر غير مهيأة على الخادم',503);
 const db=(table,suffix)=>apiRequest('/rest/v1/akkad_'+table+suffix,{token:key});
 let sources=[];
 if(isFree){
  if(!codePattern.test(scope))throw failure('كود غير صالح',400);
  const rows=await db('sources','?select=*&free_code=eq.'+scope+'&free_enabled=eq.true&limit=2');
  sources=rows.filter(isActive);
  if(sources.length!==1)throw failure('كود المصدر غير صالح أو متوقف',403);
 }else{
  const a=await auth(req);
  if(a.role==='user'){
   const [accounts,subs]=await Promise.all([
    db('viewer_accounts','?select=active&user_id=eq.'+a.user.id+'&limit=1'),
    db('subscriptions','?select=starts_at,ends_at,status&user_id=eq.'+a.user.id+'&status=eq.active&limit=50')
   ]);
   if(accounts[0]?.active!==true||!subs.some(s=>new Date(s.starts_at)<=new Date()&&new Date(s.ends_at)>new Date()))
    throw failure('يتطلب حساب VIP فعالاً ولم تنتهِ مدته',403);
  }
  sources=(await db('sources','?select=*&enabled=eq.true&license_confirmed=eq.true&order=created_at.desc&limit=1000')).filter(isActive);
 }
 if(operation==='sources')return json(res,200,{mode:isFree?'code':'vip',sources:sources.map(publicSource)});
 const sourceId=url.searchParams.get('source')||'';
 if(sourceId&&!uuid.test(sourceId))throw failure('معرف المصدر غير صالح');
 if(sourceId){
  sources=sources.filter(s=>s.id===sourceId);
  if(!sources.length)throw failure('هذا المصدر غير متاح لحسابك',403);
 }
 if(operation==='catalog'){
  const kind=url.searchParams.get('kind')||'';
  if(!kindSet.has(kind))throw failure('القسم غير صالح');
  const offset=Number(url.searchParams.get('offset')||0);
  const limit=Number(url.searchParams.get('limit')||100);
  if(!Number.isInteger(offset)||offset<0||offset>1000000||!Number.isInteger(limit)||limit<1||limit>250)throw failure('حدود الصفحة غير صالحة');
  let index=0;const items=[];let failures=0;let count=0;
  for(const source of sources){
   if(source.kind!=='xtream')continue;
   try{
    const key=source.id+':'+kind+':'+(source.last_checked_at||'');
    let entry=cache.get(key);
    if(!entry||Date.now()-entry.when>90000){
     const sealed=(await db('source_credentials','?select=*&source_id=eq.'+source.id+'&limit=1'))[0];
     if(!sealed)throw failure('بيانات المزود غير محفوظة',503);
     entry={when:Date.now(),credentials:decrypt(sealed,process.env.AKKAD_SOURCE_ENCRYPTION_KEY),snapshot:null};
     cache.set(key,entry);if(cache.size>15)cache.clear();
    }
    // Fetch only the requested page; the upstream may return a complete Xtream list.
    const localOffset=Math.max(0,offset-index);
    const needed=Math.max(1,limit-items.length);
    if(!entry.snapshot){
     entry.snapshot=await collectSource(source,entry.credentials,kind,500000,
      process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{offset:0,allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true'});
    }
    const page={total:entry.snapshot.total,items:entry.snapshot.items.slice(localOffset,localOffset+needed)};
    count+=page.total;
    if(items.length<limit&&offset<index+page.total){
     items.push(...page.items.map(x=>({...x,id:source.id+':'+kind+':'+x.external_id,source_id:source.id,source_name:source.name})).slice(0,limit-items.length));
    }
    index+=page.total;
   }catch(e){failures++;console.warn('AKKAD instant catalog source failed',source.id,kind,e.message);}
  }
  if(failures&&count===0)throw failure('تعذر تحميل محتوى المصدر. افحص اتصال Xtream من الإدارة',502);
  return json(res,200,{items,total:count,offset,limit,has_more:offset+items.length<count,failed_sources:failures});
 }
 const source=sourceId?sources[0]:sources.find(x=>x.id===url.searchParams.get('source'));
 if(!source)throw failure('اختر المصدر للتشغيل',400);
 if(source.kind!=='xtream')throw failure('هذه الميزة تدعم Xtream حالياً',422);
 const kind=url.searchParams.get('kind'),externalId=url.searchParams.get('id');
 if(!kindSet.has(kind)||!number.test(externalId||''))throw failure('معرّف المحتوى غير صالح');
 const sealed=(await db('source_credentials','?select=*&source_id=eq.'+source.id+'&limit=1'))[0];
 if(!sealed)throw failure('بيانات الحساب غير متوفرة',503);
 const creds=decrypt(sealed,process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
 if(operation==='episodes'){
  if(kind!=='series')throw failure('اختر مسلسلاً',400);
  const result=await getSeriesInfo(source,creds,externalId,process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{
   allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true'
  });
  const seasons=Object.entries(result?.episodes||{}).slice(0,150).map(([season,episodes])=>({
   season:Number(season)||1,
   episodes:(Array.isArray(episodes)?episodes:[]).slice(0,200).filter(ep=>number.test(String(ep.id))).map(ep=>{
    const ext=cleanExt(ep.container_extension)||'mp4';
    return {id:String(ep.id),title:String(ep.title||'الحلقة '+(ep.episode_num||'')).slice(0,180),
      episode_num:Number(ep.episode_num)||0,format:ext,
      url:'/api/media/'+issueTicket({source_id:source.id,media_id:source.id,kind:'episode',external_id:String(ep.id),extension:ext})};
   })
  }));
  return json(res,200,{seasons});
 }
 if(kind==='series')throw failure('اختر الحلقة أولاً',400);
 const ext=cleanExt(url.searchParams.get('ext'))||(kind==='live'?'m3u8':'mp4');
 const ticket=issueTicket({source_id:source.id,media_id:source.id,kind,external_id:externalId,extension:ext});
 return json(res,200,{url:'/api/media/'+ticket,format:kind==='live'?'hls':ext==='m3u8'?'hls':ext,label:source.name,expires_in:3600});
}
