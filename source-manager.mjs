import crypto from 'node:crypto';
import net from 'node:net';
import {lookup} from 'node:dns/promises';
const error=(s,status=400)=>Object.assign(new Error(s),{status});
const types=['live','movie','series'], actions={live:['get_live_categories','get_live_streams'],movie:['get_vod_categories','get_vod_streams'],series:['get_series_categories','get_series']};
const digest=s=>crypto.createHash('sha256').update(s).digest('hex');
export function publicAddress(ip){
 const t=net.isIP(ip);if(t===4){const [a,b,c]=ip.split('.').map(Number);
 return a!==0&&a!==10&&a!==127&&a<224&&!(a===169&&b===254)&&!(a===172&&b>=16&&b<=31)&&!(a===192&&b===168)&&!(a===100&&b>=64&&b<=127)&&!(a===192&&b===0)&&!(a===192&&b===0&&c===2)&&!(a===198&&b>=18&&b<=19)&&!(a===198&&b===51&&c===100)&&!(a===203&&b===0&&c===113);}
 if(t===6){const v=ip.toLowerCase();return v!=='::1'&&v!=='::'&&!/^(fc|fd|ff|fe80:|2001:db8:)/.test(v)&&!v.startsWith('::ffff:');}
 return false;
}
export function validateEndpoint(value,allowlist,{query=false,host=null,allowHttp=false}={}){
 let u;try{u=new URL(value);}catch{throw error('رابط المصدر غير صالح');}
 const allowed=String(allowlist||'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
 const literalIP=net.isIP(u.hostname);
 const permittedProtocol=u.protocol==='https:'||(allowHttp===true&&u.protocol==='http:');
 const safeHost=literalIP?literalIP===4&&publicAddress(u.hostname):u.hostname.includes('.')&&!u.hostname.endsWith('.local')&&u.hostname!=='localhost';
 if(!permittedProtocol||u.username||u.password||u.hash||(!query&&u.search)||!safeHost||!allowed.includes(u.hostname.toLowerCase())||(host&&u.hostname!==host))
  throw error('المصدر غير مسموح: اختر HTTP المصرّح به أو HTTPS، وأضف نطاقاً أو IP عاماً في AKKAD_ALLOWED_SOURCE_HOSTS');
 return u;
}
async function readRemote(url,allowed,options={}){
 const u=validateEndpoint(url,allowed,{query:true,host:options.host||null,allowHttp:options.allowHttp===true});
 let ips;
 try{
   ips=net.isIP(u.hostname)===4?[{address:u.hostname}]:await (options.lookup||lookup)(u.hostname,{all:true});
 }catch{throw error('تعذّر التحقق من عنوان DNS لمصدر IPTV',502);}
 if(!ips.length||ips.some(x=>!publicAddress(x.address)))throw error('عنوان المصدر غير عام',403);
 let r;
 try{r=await (options.fetch||fetch)(u,{redirect:'error',signal:AbortSignal.timeout(15000)});}
 catch(e){
   const code=String(e?.cause?.code||'');
   if(e?.name==='TimeoutError'||/TIMEOUT|ETIMEDOUT/.test(code))throw error('انتهت مهلة اتصال خادم IPTV (15 ثانية): تحقق من المنفذ واتصال المزود',504);
   if(['ECONNREFUSED','EHOSTUNREACH','ENETUNREACH'].includes(code))throw error('رفض المزود الاتصال أو خادم IPTV غير متاح من Railway',502);
   if(['ENOTFOUND','EAI_AGAIN'].includes(code))throw error('تعذّر العثور على DNS لخادم IPTV',502);
   throw error('تعذّر الاتصال بالمزود: تحقق من العنوان والمنفذ وعدم وجود حظر على خوادم Railway',502);
 }
 if(!r.ok)throw error('المصدر أعاد HTTP '+r.status,502);
 const max=24*1024*1024;
 if(Number(r.headers.get('content-length')||0)>max)throw error('قائمة المصدر أكبر من الحد',413);
 const chunks=[];let size=0;
 for await(const c of r.body){size+=c.byteLength;if(size>max)throw error('قائمة المصدر أكبر من الحد',413);chunks.push(c);}
 return Buffer.concat(chunks.map(x=>Buffer.from(x)),size).toString('utf8');
}
export function encrypt(data,key){
 if(!/^[0-9a-f]{64}$/i.test(key||''))throw error('مفتاح تشفير المصادر غير مُهيأ',503);
 const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);
 const ciphertext=Buffer.concat([c.update(JSON.stringify(data),'utf8'),c.final()]);
 return {iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),ciphertext:ciphertext.toString('base64'),updated_at:new Date().toISOString()};
}
export function decrypt(row,key){
 if(!row)throw error('أدخل بيانات اعتماد المصدر أولاً');
 if(!/^[0-9a-f]{64}$/i.test(key||''))throw error('مفتاح تشفير المصادر غير مُهيأ',503);
 try{const d=crypto.createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),Buffer.from(row.iv,'base64'));d.setAuthTag(Buffer.from(row.tag,'base64'));return JSON.parse(Buffer.concat([d.update(Buffer.from(row.ciphertext,'base64')),d.final()]).toString());}
 catch{throw error('فشل فك تشفير المصدر',503);}
}
export function parseM3U(body,sourceId,kind='live',limit=100,offset=0){
 if(!body.trimStart().startsWith('#EXTM3U'))throw error('ملف M3U غير صحيح');
 const items=[],totals={live:0,movie:0,series:0};let meta=null,matched=0;
 for(const line0 of body.split(/\r?\n/)){
  const line=line0.trim();
  if(line.startsWith('#EXTINF:')){
   const attrs={};for(const m of line.matchAll(/([\w-]+)="([^"]*)"/g))attrs[m[1]]=m[2];
   meta={title:attrs['tvg-name']||line.slice(line.indexOf(',')+1),group:attrs['group-title']||'عام',icon:attrs['tvg-logo'],id:attrs['tvg-id']};
  }else if(meta&&/^https?:\/\//i.test(line)){
   const k=/series|مسلسلات|episode/i.test(meta.group)?'series':/movie|vod|film|أفلام|سينما/i.test(meta.group)?'movie':'live';
   totals[k]++;
   if(k===kind){
    if(matched>=offset&&matched<offset+limit){
      const item=normalized({name:meta.title,stream_id:meta.id||digest(line),stream_icon:meta.icon},k,meta.group,sourceId);
      if(item)items.push(item);
    }
    matched++;
   }
   meta=null;
  }
 }
 return {items,totals};
}
export function normalized(row,kind,category,sourceId){
 const external_id=row?.series_id??row?.stream_id??row?.id;
 const title=String(row?.name||row?.title||'').trim().replace(/\s+/g,' ').slice(0,240);
 if(!title||external_id==null||String(external_id).length>160||!types.includes(kind))return null;
 const y=String(row.year||row.releasedate||row.releaseDate||row.release_date||title.match(/\((\d{4})\)/)?.[1]||'').match(/(?:19|20)\d{2}/);
 const year=y?Number(y[0]):null;
 const tmdb=Number(row.tmdb_id||row.tmdb||0),tmdb_id=Number.isSafeInteger(tmdb)&&tmdb>0?tmdb:null;
 const clean=title.toLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}]/gu,' ').replace(/\s+/g,' ').trim();
 const dedupe=kind!=='live'&&tmdb_id?'tmdb:'+kind+':'+tmdb_id:kind!=='live'&&year?'title:'+kind+':'+clean+':'+year:'origin:'+sourceId+':'+kind+':'+external_id;
 const cover=String(row.cover||row.stream_icon||'');
 return {external_id:String(external_id),title,kind,category:String(category||'عام').slice(0,100),release_year:year,tmdb_id,poster_url:cover.startsWith('https://')?cover.slice(0,2000):null,dedupe_key:digest(dedupe),container_extension:['mp4','mkv','avi','ts','m3u8'].includes(String(row.container_extension||'').toLowerCase())?String(row.container_extension).toLowerCase():null};
}
export function xtreamOverview(result){
 const x=result?.user_info;if(Number(x?.auth)!==1)throw error('حساب Xtream غير مصرح أو بياناته غير صحيحة',401);
 const expires=Number(x.exp_date),max=Number(x.max_connections),active=Number(x.active_cons);
 const status=String(x.status||'').toLowerCase();
 if(status!=='active'&&status!=='trial')throw error('حساب Xtream متوقف أو منتهي الصلاحية',403);
 if(Number.isFinite(expires)&&expires>0&&expires*1000<=Date.now())throw error('انتهت صلاحية حساب Xtream',403);
 return {status:String(x.status||'Unknown').slice(0,30),expires_at:expires>0&&Number.isFinite(expires)?new Date(expires*1000).toISOString():null,max_connections:Number.isFinite(max)?max:null,active_connections:Number.isFinite(active)?active:null};
}
async function xtream(endpoint,creds,action,allowlist,options={}){
 const base=endpoint.endsWith('/')?endpoint:endpoint+'/';
 const url=new URL('player_api.php',base);
 url.searchParams.set('username',creds.username);url.searchParams.set('password',creds.password);
 if(action)url.searchParams.set('action',action);
 const response=await readRemote(url.toString(),allowlist,{...options,host:new URL(endpoint).hostname});
 try{return JSON.parse(response);}catch{throw error('صيغة Xtream غير صحيحة',502);}
}
export async function getSeriesInfo(source,credentials,seriesId,allowlist,options={}){
 if(source.kind!=='xtream'||!/^\d{1,15}$/.test(String(seriesId)))throw error('معرف المسلسل غير صالح');
 validateEndpoint(source.endpoint,allowlist,{allowHttp:options.allowHttp===true});
 const base=source.endpoint.endsWith('/')?source.endpoint:source.endpoint+'/';
 const u=new URL('player_api.php',base);
 u.searchParams.set('username',credentials.username);
 u.searchParams.set('password',credentials.password);
 u.searchParams.set('action','get_series_info');
 u.searchParams.set('series_id',String(seriesId));
 const reply=await readRemote(u.toString(),allowlist,{...options,host:new URL(source.endpoint).hostname});
 if(reply.length>6000000)throw error('عدد حلقات المصدر أكبر من الحد المتاح',413);
 let result;try{result=JSON.parse(reply)}catch{throw error('المزود أرجع بيانات حلقات غير صالحة',502);}
 return result;
}
export async function verifySource(source,credentials,allowlist,options={}){
 validateEndpoint(source.endpoint,allowlist,{allowHttp:options.allowHttp===true});
 if(source.kind==='xtream')return xtreamOverview(await xtream(source.endpoint,credentials,null,allowlist,options));
 if(source.kind==='m3u'){
  const text=await readRemote(credentials.playlist_url,allowlist,{...options,host:new URL(source.endpoint).hostname});
  return {status:'Active',counts:parseM3U(text,source.id).totals};
 }
 throw error('نوع المصدر لا يدعم الفحص التلقائي بعد');
}
export async function collectSource(source,creds,kind,limit,allowlist,options={}){
 const offset=Number.isSafeInteger(options.offset)&&options.offset>=0?options.offset:0;
 validateEndpoint(source.endpoint,allowlist,{allowHttp:options.allowHttp===true});
 if(source.kind==='xtream'){
  const [catAction,listAction]=actions[kind];
  const [cats,rows]=await Promise.all([xtream(source.endpoint,creds,catAction,allowlist,options),xtream(source.endpoint,creds,listAction,allowlist,options)]);
  if(!Array.isArray(rows))throw error('الاستجابة لا تحتوي قائمة محتوى',502);
  const categories=new Map((Array.isArray(cats)?cats:[]).map(x=>[String(x.category_id),String(x.category_name||'عام')]));
  const items=[];let total=0;
  for(const row of rows){const x=normalized(row,kind,categories.get(String(row.category_id)),source.id);if(x){if(total>=offset&&total<offset+limit)items.push(x);total++;}}
  return {items,total,invalid:rows.length-total};
 }
 if(source.kind==='m3u'){
  const text=await readRemote(creds.playlist_url,allowlist,{...options,host:new URL(source.endpoint).hostname});
  const parsed=parseM3U(text,source.id,kind,limit,offset);
  return {items:parsed.items,total:parsed.totals[kind],invalid:0};
 }
 throw error('المصدر لا يدعم المزامنة التلقائية بعد');
}

export function prepareAccountDraft(input,allowedHosts,httpEnabled=false){
 if(!input||typeof input!=='object')throw error('بيانات المصدر مطلوبة');
 const kind=String(input.kind||'');
 if(!['xtream','m3u'].includes(kind))throw error('الفحص الحقيقي متاح حالياً لـ Xtream وM3U فقط');
 const name=String(input.name||'').trim().slice(0,100);
 if(!name)throw error('اسم المصدر مطلوب');
 if(input.license_confirmed!==true)throw error('تأكيد ترخيص المصدر مطلوب');
 const allowHttp=input.allow_insecure_http===true&&httpEnabled===true;
 const url=validateEndpoint(input.endpoint,allowedHosts,{allowHttp});
 if(url.protocol==='http:'&&!allowHttp)throw error('اتصال HTTP يحتاج موافقة خاصة وتهيئة الخادم');
 let credentials;
 if(kind==='xtream'){
   if(typeof input.username!=='string'||typeof input.password!=='string'||!input.username.trim()||!input.password
      ||input.username.length>200||input.password.length>250)throw error('أدخل اسم المستخدم وكلمة مرور Xtream كاملة');
   credentials={username:input.username.trim(),password:input.password};
 }else{
   if(typeof input.playlist_url!=='string'||input.playlist_url.length>4096||!input.playlist_url)throw error('أدخل رابط M3U الكامل');
   validateEndpoint(input.playlist_url,allowedHosts,{query:true,host:url.hostname,allowHttp});
   credentials={playlist_url:input.playlist_url};
 }
 return {source:{name,kind,endpoint:url.toString().replace(/\/$/,''),allow_insecure_http:allowHttp,license_confirmed:true},credentials};
}
export async function inspectAccount(source,credentials,allowedHosts,options={}){
 const overview=await verifySource(source,credentials,allowedHosts,options);
 const counts={live:null,movie:null,series:null};
 const warnings=[];
 if(source.kind==='m3u'){
   Object.assign(counts,overview.counts||{});
 }else{
   const countActions=[['live','get_live_streams'],['movie','get_vod_streams'],['series','get_series']];
   const checked=await Promise.allSettled(countActions.map(async ([,action])=>{
     const data=await xtream(source.endpoint,credentials,action,allowedHosts,options);
     if(!Array.isArray(data))throw error('المزود لم يرجع قائمة');
     return data.length;
   }));
   checked.forEach((r,i)=>{
     const kind=countActions[i][0];
     if(r.status==='fulfilled')counts[kind]=r.value;
     else warnings.push('تعذّر إحصاء '+({live:'القنوات',movie:'الأفلام',series:'المسلسلات'}[kind])+' من المزود؛ لا يؤثر ذلك على نجاح تسجيل الدخول');
   });
 }
 return {status:overview.status,expires_at:overview.expires_at||null,max_connections:overview.max_connections??null,
   active_connections:overview.active_connections??null,counts,warnings,checked_at:new Date().toISOString(),
   account_verified:true};
}
export async function handlePreflight({req,res,p,admin,apiRequest,readBody,json,inspect=inspectAccount}){
 if(!['/api/admin/sources/preflight','/api/admin/sources/verified-create'].includes(p))return false;
 const a=await admin(req);
 if(req.method!=='POST')throw error('طريقة الطلب غير مدعومة',405);
 const input=await readBody(req),hosts=process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'';
 const {source,credentials}=prepareAccountDraft(input,hosts,process.env.AKKAD_ALLOW_HTTP_SOURCES==='true');
 const overview=await inspect(source,credentials,hosts,{allowHttp:source.allow_insecure_http});
 if(p.endsWith('/preflight'))return json(res,200,{ok:true,overview,saved:false});
 const now=new Date().toISOString(),encrypted=encrypt(credentials,process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
 const added=await apiRequest('/rest/v1/akkad_sources',{method:'POST',token:a.token,body:{
   ...source,enabled:true,last_checked_at:now,last_check_status:'ok',last_error:null,
   provider_expires_at:overview.expires_at,provider_max_connections:overview.max_connections,
   provider_active_connections:overview.active_connections
 },extraHeaders:{Prefer:'return=representation'}});
 const record=added?.[0];if(!record?.id)throw error('تعذر إنشاء سجل المصدر',502);
 try{
   await apiRequest('/rest/v1/akkad_source_credentials',{method:'POST',token:a.token,
     body:{source_id:record.id,...encrypted},extraHeaders:{Prefer:'return=minimal'}});
 }catch(e){
   // Do not leave an enabled source after a credential-storage failure.
   await apiRequest('/rest/v1/akkad_sources?id=eq.'+record.id,{method:'PATCH',token:a.token,
     body:{enabled:false,last_check_status:'error',last_error:'تعذر حفظ بيانات الاعتماد'},extraHeaders:{Prefer:'return=minimal'}}).catch(()=>{});
   throw error('نجح الفحص لكن تعذر حفظ بيانات الدخول؛ المصدر غير مفعّل. أعد المحاولة بعد المراجعة',502);
 }
 return json(res,201,{ok:true,saved:true,item:{id:record.id,name:record.name,kind:record.kind},overview});
}

export async function handleSourceAction({req,res,p,admin,apiRequest,readBody,json}){
 const match=/^\/api\/admin\/sources\/([0-9a-f-]{36})\/(credentials|check|sync|jobs)$/.exec(p);
 if(!match)return false;
 const [,id,action]=match;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw error('معرف المصدر غير صحيح');
 const a=await admin(req);
 const query=(table,{method='GET',body,where='',prefer}={})=>apiRequest('/rest/v1/akkad_'+table+where,{method,token:a.token,body,extraHeaders:prefer?{Prefer:prefer}:{}});
 const found=await query('sources',{where:'?select=*&id=eq.'+id});const source=found?.[0];
 if(!source)throw error('المصدر غير موجود',404);
 if(action==='jobs'&&req.method==='GET'){
  const jobs=await query('source_sync_jobs',{where:'?select=id,kind,status,requested_limit,requested_offset,next_offset,available_count,imported_count,skipped_count,error_summary,started_at,completed_at&source_id=eq.'+id+'&order=started_at.desc&limit=20'});
  return json(res,200,{jobs});
 }
 if(req.method!=='POST')throw error('طريقة الطلب غير مدعومة',405);
 if(!source.license_confirmed)throw error('يجب تأكيد حقوق المصدر أولاً');
 const allowlist=process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'';
 const allowHttp=source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true';
 const transport={allowHttp};
 if(new URL(source.endpoint).protocol==='http:'&&!allowHttp)throw error('هذا المصدر يستخدم HTTP: يجب تأكيد السماح لكل مصدر وتفعيل الخيار الآمن في إعدادات Railway',400);
 if(action==='credentials'||action==='check'){
  // A check with supplied credentials verifies first, then saves only after success.
  // A check without credentials reuses a previously verified encrypted record.
  const b=await readBody(req);
  const supplied=source.kind==='xtream'?Boolean(b.username||b.password):Boolean(b.playlist_url);
  const existing=await query('source_credentials',{where:'?select=*&source_id=eq.'+id});
  let credentials;
  if(supplied){
    credentials=prepareAccountDraft({...source,...b,license_confirmed:true},allowlist,process.env.AKKAD_ALLOW_HTTP_SOURCES==='true').credentials;
  }else{
    credentials=decrypt(existing?.[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
  }
  try{
    const overview=await inspectAccount(source,credentials,allowlist,transport);
    if(supplied){
      const encrypted=encrypt(credentials,process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
      await query('source_credentials',{method:'POST',where:'?on_conflict=source_id',body:{source_id:id,...encrypted},prefer:'resolution=merge-duplicates,return=minimal'});
    }
    await query('sources',{method:'PATCH',where:'?id=eq.'+id,body:{
      last_checked_at:overview.checked_at,last_check_status:'ok',last_error:null,enabled:true,
      provider_expires_at:overview.expires_at,provider_max_connections:overview.max_connections,
      provider_active_connections:overview.active_connections
    }});
    return json(res,200,{ok:true,saved:Boolean(supplied),overview});
  }catch(e){
    // A failed check must not activate or replace existing good credentials.
    await query('sources',{method:'PATCH',where:'?id=eq.'+id,body:{last_checked_at:new Date().toISOString(),last_check_status:'error',last_error:String(e.message).slice(0,150),enabled:false}}).catch(()=>{});
    throw e;
  }
 }
 const credentialsRecord=await query('source_credentials',{where:'?select=*&source_id=eq.'+id});
 const credentials=decrypt(credentialsRecord?.[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
 if(action!=='sync')throw error('العملية غير معروفة',404);
 const b=await readBody(req);const kind=b.kind,limit=Number(b.limit);
 if(!types.includes(kind)||![10,50,100].includes(limit))throw error('حدد قسماً وعدداً 10 أو 50 أو 100');
 if(!source.enabled||source.last_check_status!=='ok')throw error('افحص المصدر بنجاح أولاً قبل المزامنة');
 await query('source_sync_jobs',{method:'PATCH',where:'?source_id=eq.'+id+'&kind=eq.'+kind+'&status=eq.running&started_at=lt.'+new Date(Date.now()-600000).toISOString(),body:{status:'failed',completed_at:new Date().toISOString(),error_summary:'تجاوز المهمة مهلة التنفيذ'}});
 const running=await query('source_sync_jobs',{where:'?select=id&source_id=eq.'+id+'&kind=eq.'+kind+'&status=eq.running&limit=1'});
 if(running.length)throw error('مزامنة أخرى جارية',409);
 const recent=await query('source_sync_jobs',{where:'?select=next_offset,available_count&source_id=eq.'+id+'&kind=eq.'+kind+'&status=eq.success&order=started_at.desc&limit=1'});
 const offset=b.reset===true?0:(recent[0]?.next_offset||0);
 if(b.reset!==true&&recent.length&&offset>=recent[0].available_count){
   return json(res,200,{ok:true,complete:true,imported:0,available:recent[0].available_count,next_offset:offset,has_more:false,note:'اكتملت مزامنة القائمة؛ اختر إعادة من البداية لفحص العناصر الجديدة'});
 }
 const job=await query('source_sync_jobs',{method:'POST',body:{source_id:id,kind,requested_limit:limit,requested_offset:offset,status:'running'},prefer:'return=representation'});
 try{
  const gathered=await collectSource(source,credentials,kind,limit,allowlist,{offset,...transport});
  const items=[...new Map(gathered.items.map(x=>[x.external_id,x])).values()];
  if(items.length){
   const distinct=[...new Map(items.map(x=>[x.dedupe_key,x])).values()];
   const now=new Date().toISOString();
   await query('catalog',{method:'POST',where:'?on_conflict=dedupe_key',body:distinct.map(x=>({title:x.title,kind:x.kind,category:x.category,poster_url:x.poster_url,release_year:x.release_year,tmdb_id:x.tmdb_id,dedupe_key:x.dedupe_key,source_id:id,last_synced_at:now,published:false})),prefer:'resolution=ignore-duplicates,return=minimal'});
   const rows=await query('catalog',{where:'?select=id,dedupe_key&dedupe_key=in.('+distinct.map(x=>x.dedupe_key).join(',')+')&limit=200'});
   const map=new Map(rows.map(x=>[x.dedupe_key,x.id]));
   if(distinct.some(x=>!map.has(x.dedupe_key)))throw error('فشل ربط الكتالوج بالمصدر',502);
   await query('source_items',{method:'POST',where:'?on_conflict=source_id,kind,external_id',body:items.map(x=>({source_id:id,catalog_id:map.get(x.dedupe_key),kind,external_id:x.external_id,category:x.category,container_extension:x.container_extension,last_seen_at:now})),prefer:'resolution=merge-duplicates,return=minimal'});
  }
  const countsData=await apiRequest('/rest/v1/rpc/akkad_source_counts',{method:'POST',token:a.token,body:{p_source:id}});
  const counts=Array.isArray(countsData)?countsData[0]:countsData;
  const now=new Date().toISOString();
  await query('sources',{method:'PATCH',where:'?id=eq.'+id,body:{last_synced_at:now,last_error:null,live_count:counts?.live||0,movie_count:counts?.movie||0,series_count:counts?.series||0}});
  const nextOffset=Math.min(gathered.total,offset+limit);
  await query('source_sync_jobs',{method:'PATCH',where:'?id=eq.'+job[0].id,body:{status:'success',imported_count:items.length,skipped_count:gathered.invalid,requested_offset:offset,next_offset:nextOffset,available_count:gathered.total,completed_at:now}});
  return json(res,200,{ok:true,imported:items.length,available:gathered.total,skipped:gathered.invalid,stored:counts,next_offset:nextOffset,has_more:nextOffset<gathered.total,note:'تُضاف البيانات كمسودات دون نسخ أسرار وروابط تشغيل'});
 }catch(e){
  await query('source_sync_jobs',{method:'PATCH',where:'?id=eq.'+job[0].id,body:{status:'failed',error_summary:String(e.message).slice(0,180),completed_at:new Date().toISOString()}}).catch(()=>{});
  throw e;
 }
}
