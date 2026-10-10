import {validateEndpoint,encrypt,decrypt} from './source-manager.mjs';
const err=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const uuid=/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export async function tmdbLookup(title,kind,key,fetcher=fetch){
 if(typeof title!=='string'||title.trim().length<2||title.length>150||!['movie','series','anime'].includes(kind))err('بحث TMDb غير صالح');
 const url=new URL('https://api.themoviedb.org/3/search/'+(kind==='movie'?'movie':'tv'));
 url.searchParams.set('query',title.trim());url.searchParams.set('language','ar-IQ');url.searchParams.set('include_adult','false');
 const isV3=/^[a-f0-9]{32}$/i.test(key||'');
 if(isV3)url.searchParams.set('api_key',key);
 let response;try{response=await fetcher(url,{headers:isV3?{}:{Authorization:'Bearer '+key},signal:AbortSignal.timeout(9500)})}catch{err('خدمة TMDb غير متاحة',502)}
 if(!response.ok)err('رفض TMDb الطلب: HTTP '+response.status,502);
 const body=await response.json();
 return (body.results||[]).slice(0,6).map(x=>({
  tmdb_id:x.id,title:x.title||x.name||'',description:x.overview||'',
  release_year:Number((x.release_date||x.first_air_date||'').slice(0,4))||null,
  poster_url:x.poster_path&&/^\/[\w-]+\.(jpg|webp|png)$/.test(x.poster_path)?'https://image.tmdb.org/t/p/w500'+x.poster_path:null
 }));
}
export async function adminExtras({req,res,p,auth,readBody,apiRequest,json}){
 const free=/^\/api\/free\/[A-Z0-9]{2,12}\/catalog$/.test(p);
 if(!free&&!p.startsWith('/api/admin/extra/'))return false;
 const q=(table,tail='',token)=>apiRequest('/rest/v1/akkad_'+table+tail,{token});
 if(free){
  if(req.method!=='GET')err('طريقة غير مدعومة',405);
  const code=p.split('/')[3];
  const data=await apiRequest('/rest/v1/rpc/akkad_free_catalog',{method:'POST',body:{p_code:code}});
  if(!data?.source)err('كود المصدر غير متاح',404);
  return json(res,200,{source:data.source,items:data.items||[]});
 }
 const admin=await auth(req,{admin:true});
 const get=(t,query='')=>q(t,query,admin.token);
 const change=(t,method,query,body)=>apiRequest('/rest/v1/akkad_'+t+query,{method,body,token:admin.token,extraHeaders:{Prefer:t==='config'?'resolution=merge-duplicates,return=representation':'return=representation'}});
 const route=p.slice('/api/admin/extra/'.length);
 if(route==='tmdb'){
  if(req.method==='GET'){
   const state=await get('config','?select=setting_key,updated_at&setting_key=eq.tmdb_api');
   return json(res,200,{configured:Boolean(state?.length),updated_at:state?.[0]?.updated_at||null});
  }
  if(admin.role!=='super_admin')err('مدير أساسي فقط',403);
  if(req.method!=='POST')err('طريقة غير مدعومة',405);
  const b=await readBody(req);
  if(typeof b.key!=='string'||b.key.length<20||b.key.length>800)err('مفتاح TMDb غير صالح');
  await tmdbLookup('Dune','movie',b.key);
  const sealed=encrypt({key:b.key},process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
  await change('config','POST','?on_conflict=setting_key',{setting_key:'tmdb_api',...sealed});
  return json(res,200,{ok:true,configured:true});
 }
 if(route==='tmdb/search'){
  if(req.method!=='POST')err('طريقة غير مدعومة',405);
  const b=await readBody(req),settings=await get('config','?select=*&setting_key=eq.tmdb_api');
  if(!settings?.length)err('أضف مفتاح TMDb أولاً');
  const key=decrypt(settings[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY).key;
  return json(res,200,{results:await tmdbLookup(b.title,b.kind,key)});
 }
 const match=/^source\/([\da-f-]{36})$/.exec(route);
 if(!match)err('مسار غير معروف',404);
 const id=match[1];if(!uuid.test(id))err('معرف غير صالح');
 const source=(await get('sources','?select=*&id=eq.'+id))?.[0];
 if(!source)err('المصدر غير موجود',404);
 if(req.method==='PATCH'){
  const b=await readBody(req),patch={};
  if(b.name!==undefined){patch.name=String(b.name||'').trim().slice(0,100);if(!patch.name)err('اسم المزوّد مطلوب')}
  for(const field of ['auto_import','auto_publish','free_enabled'])if(typeof b[field]==='boolean')patch[field]=b[field];
  if(b.free_code!==undefined){
   const code=String(b.free_code||'').trim().toUpperCase();
   if(code&&!/^[A-Z0-9]{2,12}$/.test(code))err('الكود مثل A1 يتكون من 2–12 حرفاً أو رقماً');
   patch.free_code=code||null;
  }
  if(b.auto_interval_minutes!==undefined){
   const interval=Number(b.auto_interval_minutes);if(!Number.isInteger(interval)||interval<30||interval>10080)err('التحديث من 30 دقيقة إلى أسبوع');
   patch.auto_interval_minutes=interval;
  }
  if(b.enabled!==undefined){if(b.enabled&&source.last_check_status!=='ok')err('افحص المصدر أولاً');patch.enabled=Boolean(b.enabled)}
  if(b.endpoint!==undefined&&b.endpoint!==source.endpoint){
   const url=validateEndpoint(b.endpoint,process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{allowHttp:source.allow_insecure_http===true});
   patch.endpoint=url.toString().replace(/\/$/,'');patch.last_check_status='never';patch.enabled=false;
  }
  if((patch.free_enabled||patch.auto_publish||patch.auto_import)&&(!(patch.enabled??source.enabled)||source.last_check_status!=='ok'||!source.license_confirmed))
   err('يجب فحص المزوّد وتفعيله وتأكيد الترخيص أولاً');
  if(patch.free_enabled&&!((patch.free_code??source.free_code)||''))err('أضف كود المصدر أولاً');
  if(patch.auto_import&&!process.env.SUPABASE_SERVICE_ROLE_KEY)err('المزامنة التلقائية تحتاج إلى إعداد حساب الخادم الآمن على Railway',503);
  if(!Object.keys(patch).length)err('لم تحدد تعديلاً');
  const rows=await change('sources','PATCH','?id=eq.'+id,patch);
  return json(res,200,{item:rows[0]});
 }
 if(req.method==='DELETE'){
  if(admin.role!=='super_admin')err('حذف المصادر للمدير الأساسي فقط',403);
  await change('catalog','PATCH','?source_id=eq.'+id,{published:false});
  await change('sources','DELETE','?id=eq.'+id);
  return json(res,200,{ok:true});
 }
 err('طريقة غير مدعومة',405);
}
