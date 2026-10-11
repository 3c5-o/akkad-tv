import crypto from 'node:crypto';
import {decrypt,collectSource,getSeriesInfo} from './source-manager.mjs';
import {checkPassword} from './admin-xtream.mjs';
import {issueTicket} from './media-gateway.mjs';

const accountName=/^[a-z0-9_]{3,32}$/;
const numeric=/^\d{1,15}$/;
const failure=(message,status=400)=>Object.assign(new Error(message),{status});
const extAllowed=new Set(['mp4','mkv','avi','m3u8','ts']);
const dataKinds={get_live_streams:'live',get_vod_streams:'movie',get_series:'series'};
const catKinds={get_live_categories:'live',get_vod_categories:'movie',get_series_categories:'series'};
const publicBase=()=>new URL(process.env.AKKAD_PUBLIC_XTREAM_BASE_URL||'https://akkad-core-production.up.railway.app');
const categoryId=(source,kind,name)=>String(parseInt(crypto.createHash('sha256').update(source.id+':'+kind+':'+name).digest('hex').slice(0,12),16)%900000000+100000000);
const cleanExt=s=>extAllowed.has(String(s||'').toLowerCase())?String(s).toLowerCase():'mp4';
const streamPath=(kind,user,password,id,ext)=>'/'+(kind==='movie'?'movie':kind==='episode'?'series':'live')+'/'+encodeURIComponent(user)+'/'+encodeURIComponent(password)+'/'+id+'.'+ext;

export async function xtreamCompat({req,res,p,url,apiRequest,json,handleMedia}){
 if(p!=='/player_api.php'&&p!=='/get.php'&&!/^\/(live|movie|series)\//.test(p))return false;
 if(!['GET','POST'].includes(req.method))throw failure('طريقة غير مدعومة',405);
 if(req.method==='POST'){
  // Legacy IPTV players frequently send form-encoded POST rather than GET.
  // Accept form or JSON without ever including credentials in logs.
  const parts=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>8192)throw failure('بيانات الدخول كبيرة جداً',413);parts.push(chunk);}
  const raw=Buffer.concat(parts).toString('utf8');
  let form;
  const type=String(req.headers['content-type']||'').toLowerCase();
  if(type.includes('application/json')){
   try{const obj=JSON.parse(raw||'{}');form=new URLSearchParams();
    for(const key of ['username','password','action','category_id','series_id','vod_id','output','type']){
     if(typeof obj[key]==='string'||typeof obj[key]==='number')form.set(key,String(obj[key]));
    }
   }catch{throw failure('بيانات طلب Xtream غير مفهومة')}
  }else form=new URLSearchParams(raw);
  for(const key of ['username','password','action','category_id','series_id','vod_id','output','type']){
   if(form.has(key)&&!url.searchParams.has(key))url.searchParams.set(key,form.get(key));
  }
 }
 const role=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!role||!process.env.AKKAD_SOURCE_ENCRYPTION_KEY)throw failure('بوابة Xtream غير مهيأة',503);
 const db=(table,tail='',method='GET',body,extraHeaders={})=>apiRequest('/rest/v1/akkad_'+table+tail,{
  token:role,method,body,extraHeaders
 });
 const stream=/^\/(live|movie|series)\/([^/]+)\/([^/]+)\/(\d{1,15})\.(ts|m3u8|mp4|mkv|avi)$/.exec(p);
 if(p!=='/player_api.php'&&p!=='/get.php'&&!stream)throw failure('مسار تشغيل غير مدعوم',404);
 const username=stream?decodeURIComponent(stream[2]):url.searchParams.get('username')||'';
 const password=stream?decodeURIComponent(stream[3]):url.searchParams.get('password')||'';
 if(!accountName.test(username)||typeof password!=='string'||password.length<8||password.length>256)
  throw failure('اسم المستخدم أو كلمة المرور غير صحيحة',401);
 const accounts=await db('xtream_accounts','?select=*&username=eq.'+username+'&limit=1');
 const account=accounts[0];
 if(!account||!checkPassword(password,account.password_hash)||account.active!==true||new Date(account.expires_at)<=new Date())
  throw failure('حساب Xtream غير فعال أو انتهت مدته',401);
 const allSources=(await db('sources','?select=*&enabled=eq.true&license_confirmed=eq.true&order=created_at.desc&limit=1000'))
   .filter(s=>s.kind==='xtream'&&s.last_check_status==='ok'&&(!s.provider_expires_at||new Date(s.provider_expires_at)>new Date()));
 const sources=allSources.filter(s=>!account.source_ids?.length||account.source_ids.includes(s.id));
 const sourceMap=new Map(sources.map(s=>[s.id,s]));
 const loadCred=async source=>{
  const rows=await db('source_credentials','?select=*&source_id=eq.'+source.id+'&limit=1');
  if(!rows.length)throw failure('بيانات المصدر غير محفوظة',503);
  return decrypt(rows[0],process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
 };
 const aliasLookup=async alias=>{
  if(!numeric.test(alias))throw failure('رمز المحتوى غير صالح');
  const rows=await db('xtream_stream_map','?select=id,source_id,kind,external_id&id=eq.'+alias+'&limit=1');
  const found=rows[0];
  if(!found||!sourceMap.has(found.source_id))throw failure('المحتوى غير متاح للحساب',403);
  return found;
 };
 const mapItems=async items=>{
  const unique=new Map();
  for(const row of items)unique.set(row.source_id+':'+row.kind+':'+row.external_id,
   {source_id:row.source_id,kind:row.kind,external_id:row.external_id});
  const aliases=new Map();
  const records=[...unique.values()];
  for(let i=0;i<records.length;i+=250){
   const chunk=records.slice(i,i+250);
   const saved=await db('xtream_stream_map','?on_conflict=source_id,kind,external_id','POST',chunk,
    {Prefer:'resolution=merge-duplicates,return=representation'});
   for(const r of saved)aliases.set(r.source_id+':'+r.kind+':'+r.external_id,String(r.id));
  }
  return aliases;
 };
 const fetchItems=async kind=>{
  const combined=[];let failed=0;
  for(const source of sources){
   try{
    const credentials=await loadCred(source);
    const result=await collectSource(source,credentials,kind,100000,
     process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true'});
    combined.push(...result.items.map(x=>({...x,source_id:source.id,source_name:source.name})));
   }catch(e){failed++;console.warn('Xtream compatibility source failed',source.id,kind,e.message);}
  }
  if(!combined.length&&failed)throw failure('المزودون لا يستجيبون حالياً',502);
  return combined;
 };
 const info=async()=>{
  const u=publicBase(),time=new Date();
  return {user_info:{
    username,password,auth:1,status:'Active',exp_date:String(Math.floor(new Date(account.expires_at).getTime()/1000)),
    is_trial:'0',active_cons:'0',created_at:String(Math.floor(new Date(account.created_at).getTime()/1000)),
    max_connections:String(account.max_connections),allowed_output_formats:['m3u8','ts','mp4']
   },server_info:{
    url:u.hostname,port:String(u.port||(u.protocol==='https:'?443:80)),
    https_port:u.protocol==='https:'?String(u.port||443):'443',
    server_protocol:u.protocol.replace(':',''),timezone:'Asia/Baghdad',
    timestamp_now:Math.floor(time.getTime()/1000),time_now:time.toISOString()
   }};
 };
 if(stream){
  const [_,type,,,alias,extension]=stream;
  const row=await aliasLookup(alias);
  const need=type==='series'?'episode':type;
  if(row.kind!==need)throw failure('نوع المحتوى لا يطابق الرابط',403);
  const ticket=issueTicket({source_id:row.source_id,media_id:row.source_id,kind:row.kind,
   external_id:row.external_id,extension:extension==='m3u8'?'m3u8':extension});
  const relay=new URL('/api/media/'+ticket+(type==='live'&&extension==='ts'?'?format=ts':''),publicBase());
  return handleMedia({...{req,res,p:'/api/media/'+ticket,url:relay,apiRequest,json}});
 }
 if(p==='/player_api.php'){
  const action=url.searchParams.get('action')||'';
  if(!action)return json(res,200,await info());
  if(catKinds[action]){
   const kind=catKinds[action],items=await fetchItems(kind),categories=new Map();
   for(const it of items)categories.set(categoryId(sourceMap.get(it.source_id),kind,it.category),it.category);
   return json(res,200,[...categories].map(([category_id,category_name])=>({category_id,category_name,parent_id:0})));
  }
  if(dataKinds[action]){
   const kind=dataKinds[action],items=await fetchItems(kind),aliases=await mapItems(items);
   const categoryFilter=url.searchParams.get('category_id');
   return json(res,200,items.filter(x=>!categoryFilter||categoryId(sourceMap.get(x.source_id),kind,x.category)===categoryFilter)
    .map((x,i)=>{
     const alias=Number(aliases.get(x.source_id+':'+kind+':'+x.external_id));
     const common={num:i+1,category_id:categoryId(sourceMap.get(x.source_id),kind,x.category)};
     if(kind==='series')return {...common,name:x.title,series_id:alias,cover:x.poster_url||'',plot:'',last_modified:'',rating:'0'};
     return {...common,name:x.title,stream_type:kind==='live'?'live':'movie',stream_id:alias,
       stream_icon:x.poster_url||'',added:'',container_extension:kind==='live'?'m3u8':cleanExt(x.container_extension),
       direct_source:'',epg_channel_id:null};
    }));
  }
  if(action==='get_series_info'||action==='get_vod_info'){
   const alias=url.searchParams.get(action==='get_series_info'?'series_id':'vod_id')||'';
   const row=await aliasLookup(alias);
   if(row.kind!==(action==='get_series_info'?'series':'movie'))throw failure('معرف غير صالح',400);
   const source=sourceMap.get(row.source_id),creds=await loadCred(source);
   if(action==='get_vod_info')return json(res,200,{info:{name:'فيلم',stream_id:Number(alias)},movie_data:{stream_id:Number(alias),container_extension:'mp4'}});
   const data=await getSeriesInfo(source,creds,row.external_id,process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{
    allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true'});
   const allEpisodes=Object.values(data.episodes||{}).flat().filter(ep=>numeric.test(String(ep?.id))).map(ep=>({source_id:source.id,kind:'episode',external_id:String(ep.id)}));
   const mapped=await mapItems(allEpisodes);
   const episodes=Object.fromEntries(Object.entries(data.episodes||{}).map(([season,rows])=>[season,
    (Array.isArray(rows)?rows:[]).filter(ep=>numeric.test(String(ep.id))).map(ep=>({...ep,
      id:Number(mapped.get(source.id+':episode:'+ep.id)),container_extension:cleanExt(ep.container_extension)
    }))]));
   return json(res,200,{info:data.info||{},episodes,seasons:data.seasons||[]});
  }
  return json(res,200,[]);
 }
 const output=url.searchParams.get('output')==='ts'?'ts':'m3u8';
 // Prepare source responses before sending headers, avoiding partial/corrupt M3U files.
 const bundles=[];
 for(const kind of ['live','movie']){
  const items=await fetchItems(kind),mapped=await mapItems(items);
  bundles.push({kind,items,mapped});
 }
 res.writeHead(200,{'content-type':'audio/x-mpegurl; charset=utf-8','cache-control':'private, no-store',
  'content-disposition':'attachment; filename="akkad.m3u"','x-content-type-options':'nosniff'});
 res.write('#EXTM3U\n');
 for(const {kind,items,mapped} of bundles){
  for(const x of items){
   const alias=mapped.get(x.source_id+':'+kind+':'+x.external_id);if(!alias)continue;
   const ext=kind==='live'?output:cleanExt(x.container_extension);
   const link=new URL(streamPath(kind,username,password,alias,ext),publicBase());
   const group=String(x.category||'عام').replace(/["\r\n]/g,'');
   const title=String(x.title).replace(/[\r\n]/g,' ');
   res.write('#EXTINF:-1 group-title="'+group+'",'+title+'\n'+link+'\n');
  }
 }
 res.end();return true;
}
