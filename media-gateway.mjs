import crypto from 'node:crypto';
import net from 'node:net';
import { lookup } from 'node:dns/promises';
import { Readable } from 'node:stream';
import { decrypt, validateEndpoint, publicAddress } from './source-manager.mjs';

const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const numeric=/^\d{1,15}$/;
const error=(message,status=400)=>{const e=new Error(message);e.status=status;throw e;};
const b64=b=>Buffer.from(b).toString('base64url');
const from64=s=>Buffer.from(s,'base64url');
function keys(){
 const root=process.env.AKKAD_SOURCE_ENCRYPTION_KEY;
 if(!/^[0-9a-f]{64}$/i.test(root||''))error('مفتاح التشفير غير مهيأ على الخادم',503);
 const master=Buffer.from(root,'hex');
 return {
  sign:Buffer.from(crypto.hkdfSync('sha256',master,Buffer.from('AKKAD_IPTV_V1'),'PLAYBACK_SIGN',32)),
  seal:Buffer.from(crypto.hkdfSync('sha256',master,Buffer.from('AKKAD_IPTV_V1'),'PLAYBACK_ASSET',32))
 };
}
export function issueTicket({source_id,media_id,kind,external_id,extension}){
 if(!uuid.test(source_id)||!uuid.test(media_id)||!['live','movie','episode'].includes(kind)||!numeric.test(String(external_id)))error('معرف التشغيل غير صالح');
 const body={s:source_id,m:media_id,k:kind,x:String(external_id),ext:extension||null,exp:Math.floor(Date.now()/1000)+3600};
 const payload=b64(JSON.stringify(body));
 const mac=crypto.createHmac('sha256',keys().sign).update(payload).digest('base64url');
 return payload+'.'+mac;
}
export function verifyTicket(ticket){
 if(!/^[a-zA-Z0-9_-]{10,900}\.[a-zA-Z0-9_-]{43}$/.test(ticket||''))error('رمز مشاهدة غير صحيح',403);
 const [payload,mac]=ticket.split('.');
 const expected=crypto.createHmac('sha256',keys().sign).update(payload).digest();
 const got=from64(mac);
 if(got.length!==expected.length||!crypto.timingSafeEqual(got,expected))error('رابط مشاهدة غير صالح',403);
 let data;try{data=JSON.parse(from64(payload).toString('utf8'));}catch{error('رمز المشاهدة غير مفهوم',403);}
 if(!Number.isSafeInteger(data.exp)||data.exp<Math.floor(Date.now()/1000)||data.exp>Math.floor(Date.now()/1000)+3601||
 !uuid.test(data.s)||!uuid.test(data.m)||!['live','movie','episode'].includes(data.k)||!numeric.test(String(data.x)))error('انتهت صلاحية رابط المشاهدة',403);
 return data;
}
export function sealAsset(url){
 const key=keys().seal,iv=crypto.randomBytes(12);
 const cipher=crypto.createCipheriv('aes-256-gcm',key,iv);
 const enc=Buffer.concat([cipher.update(url,'utf8'),cipher.final()]);
 return b64(Buffer.concat([iv,cipher.getAuthTag(),enc]));
}
export function openAsset(code){
 if(typeof code!=='string'||code.length>12000)error('رابط مقطع غير صالح',403);
 const buf=from64(code);if(buf.length<29)error('مقطع غير صالح',403);
 try{
  const d=crypto.createDecipheriv('aes-256-gcm',keys().seal,buf.subarray(0,12));
  d.setAuthTag(buf.subarray(12,28));
  return Buffer.concat([d.update(buf.subarray(28)),d.final()]).toString('utf8');
 }catch{error('رابط مقطع غير مصرح',403);}
}
export function xtreamMediaUrl(source,creds,identity,format){
 const base=new URL(source.endpoint.endsWith('/')?source.endpoint:source.endpoint+'/');
 if(!numeric.test(String(identity.x))||source.kind!=='xtream')error('محتوى غير مدعوم من هذا المصدر',422);
 const ext=identity.k==='live'?(format==='ts'?'ts':'m3u8'):
  identity.k==='episode'?String(identity.ext||'mp4').toLowerCase():'mp4';
 if(!['m3u8','ts','mp4','mkv','avi'].includes(ext))error('صيغة فيديو غير مدعومة',422);
 const dir=identity.k==='live'?'live':identity.k==='episode'?'series':'movie';
 if(typeof creds.username!=='string'||typeof creds.password!=='string'||!creds.username||!creds.password)error('بيانات الحساب غير مكتملة',503);
 const relative=[dir,encodeURIComponent(creds.username),encodeURIComponent(creds.password),identity.x+'.'+ext].join('/');
 return new URL(relative,base).toString();
}
function allowedMediaUrl(value,source){
 const root=new URL(source.endpoint);
 const result=validateEndpoint(value,process.env.AKKAD_ALLOWED_SOURCE_HOSTS||'',{
  query:true,host:root.hostname,
  allowHttp:source.allow_insecure_http===true&&process.env.AKKAD_ALLOW_HTTP_SOURCES==='true'
 });
 if(result.origin!==root.origin)error('رابط تشغيل بمضيف أو منفذ غير مسموح',403);
 return result.toString();
}
async function requestMedia(upstream,source,{range}={}){
 const target=allowedMediaUrl(upstream,source),u=new URL(target);
 const ips=net.isIP(u.hostname)===4?[{address:u.hostname}]:await lookup(u.hostname,{all:true}).catch(()=>[]);
 if(!ips.length||ips.some(v=>!publicAddress(v.address)))error('عنوان مزود البث غير آمن',403);
 const headers={'user-agent':'AKKAD-TV/1.0'};
 if(range&&/^bytes=\d+-\d*$/.test(range))headers.range=range;
 try{
  const response=await fetch(target,{redirect:'manual',headers,signal:AbortSignal.timeout(18000)});
  if(!response.ok)error('رفض المصدر تشغيل الملف (HTTP '+response.status+')',response.status===404?404:502);
  return {response,upstream:target};
 }catch(e){if(e.status)throw e;error('تعذر الاتصال بخادم تشغيل IPTV',502);}
}
function rewriteHls(body,base,ticket,source){
 const rewrite=value=>{
  const absolute=new URL(value,base).toString();
  allowedMediaUrl(absolute,source);
  return '/api/media/'+encodeURIComponent(ticket)+'?asset='+encodeURIComponent(sealAsset(absolute));
 };
 return body.split(/\r?\n/).map(line=>{
  const trimmed=line.trim();
  if(trimmed.startsWith('#')){
    if(/\bURI="[^"]+"/.test(line)){
      return line.replace(/\bURI="([^"]+)"/g,(_whole,link)=>'URI="'+rewrite(link)+'"');
    }
    return line;
  }
  return trimmed?rewrite(trimmed):line;
 }).join('\n');
}
export async function handleMedia({req,res,p,url,auth,apiRequest,json}){
 if(!p.startsWith('/api/free/')&&!p.startsWith('/api/watch/')&&!p.startsWith('/api/episodes/')&&!p.startsWith('/api/media/'))return false;
 const role=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!role)error('SUPABASE_SERVICE_ROLE_KEY غير مهيأ على الخادم',503);
 const getPriv=async(table,where)=>apiRequest('/rest/v1/akkad_'+table+where,{token:role});
 const maybeFree=/^\/api\/free\/([A-Z0-9]{2,12})\/(watch|episodes)\/([0-9a-f-]{36})$/.exec(p);
 const maybeMember=/^\/api\/(watch|episodes)\/([0-9a-f-]{36})$/.exec(p);
 const media=/^\/api\/media\/([A-Za-z0-9._-]+)$/.exec(p);
 if(!maybeFree&&!maybeMember&&!media)return false;
 if(req.method!=='GET')error('طريقة غير مدعومة',405);
 if(maybeFree||maybeMember){
  const item=maybeFree?maybeFree[3]:maybeMember[2];
  if(!uuid.test(item))error('معرف محتوى غير صالح');
  let info;
  if(maybeFree){
    const reply=await apiRequest('/rest/v1/rpc/akkad_free_item',{method:'POST',body:{p_code:maybeFree[1],p_item:item}});
    info=reply?.[0];
  }else{
    const user=await auth(req);
    const reply=await apiRequest('/rest/v1/rpc/akkad_member_item',{method:'POST',token:user.token,body:{p_item:item}});
    info=reply?.[0];
  }
  if(!info)error('المحتوى غير متاح للحساب أو الكود',403);
  const sources=await getPriv('sources','?select=*&id=eq.'+info.source_id);
  const source=sources?.[0];
  if(!source?.enabled||!source.license_confirmed||source.last_check_status!=='ok')error('المصدر غير متصل حالياً',503);
  if(source.kind!=='xtream')error('التشغيل المباشر لهذا النوع من المصادر غير متاح بعد',422);
  if(!numeric.test(String(info.external_id)))error('صيغة معرّف Xtream غير قابلة للتشغيل',422);
  const cred=(await getPriv('source_credentials','?select=*&source_id=eq.'+source.id))?.[0];
  if(!cred)error('بيانات المصدر غير محفوظة',503);
  const name=maybeFree?maybeFree[2]:maybeMember[1];
  if(name==='episodes'){
   if(info.kind!=='series')error('هذا المحتوى ليس مسلسلاً',400);
   const credentials=decrypt(cred,process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
   const apiUrl=new URL('player_api.php',source.endpoint.endsWith('/')?source.endpoint:source.endpoint+'/');
   apiUrl.searchParams.set('username',credentials.username);
   apiUrl.searchParams.set('password',credentials.password);
   apiUrl.searchParams.set('action','get_series_info');
   apiUrl.searchParams.set('series_id',info.external_id);
   const result=await requestMedia(apiUrl.toString(),source);
   if(Number(result.response.headers.get('content-length')||0)>6000000)error('بيانات حلقات كثيرة جداً',413);
   const raw=await result.response.text();
   if(raw.length>6000000)error('بيانات حلقات كثيرة جداً',413);
   let body;try{body=JSON.parse(raw);}catch{error('فشل قراءة حلقات المصدر',502);}
   const seasons=Object.entries(body?.episodes||{}).slice(0,100).map(([season,items])=>({
    season:Number(season)||1,
    episodes:(Array.isArray(items)?items:[]).slice(0,150).filter(ep=>numeric.test(String(ep.id))).map(ep=>({
     id:String(ep.id),title:String(ep.title||'الحلقة '+(ep.episode_num||'')).slice(0,180),
     episode_num:Number(ep.episode_num)||0,
     url:'/api/media/'+issueTicket({source_id:source.id,media_id:item,kind:'episode',
        external_id:String(ep.id),extension:['mp4','mkv','ts','m3u8','avi'].includes(ep.container_extension)?ep.container_extension:'mp4'})
    }))
   }));
   return json(res,200,{seasons});
  }
  if(info.kind==='series')error('اختر حلقة من قائمة المسلسل أولاً',400);
  const type=info.kind==='live'?'live':'movie';
  const format=type==='live'&&url.searchParams.get('format')==='ts'?'ts':type==='live'?'hls':'mp4';
  const ticket=issueTicket({source_id:source.id,media_id:item,kind:type,external_id:info.external_id});
  return json(res,200,{url:'/api/media/'+ticket+(format==='ts'?'?format=ts':''),format,
   label:source.name,expires_in:3600});
 }
 const ticket=media[1],info=verifyTicket(ticket);
 const sources=await getPriv('sources','?select=*&id=eq.'+info.s);
 const source=sources?.[0];
 if(!source?.enabled||!source.license_confirmed||source.last_check_status!=='ok'||(source.provider_expires_at&&new Date(source.provider_expires_at)<new Date()))error('مزود التشغيل غير متاح',503);
 const sealed=(await getPriv('source_credentials','?select=*&source_id=eq.'+info.s))?.[0];
 const creds=decrypt(sealed,process.env.AKKAD_SOURCE_ENCRYPTION_KEY);
 const target=url.searchParams.has('asset')?openAsset(url.searchParams.get('asset')):xtreamMediaUrl(source,creds,info,url.searchParams.get('format'));
 const response=await requestMedia(target,source,{range:req.headers.range});
 const r=response.response;
 const isPlaylist=/\.m3u8(?:$|\?)/i.test(response.upstream)||/mpegurl/i.test(r.headers.get('content-type')||'');
 if(isPlaylist){
  const body=await r.text();
  if(body.length>8000000)error('قائمة التشغيل أكبر من الحد',413);
  const rewritten=rewriteHls(body,response.upstream,ticket,source);
  res.writeHead(200,{'content-type':'application/vnd.apple.mpegurl; charset=utf-8','cache-control':'no-store',
     'access-control-allow-origin':'*','x-content-type-options':'nosniff'});
  res.end(rewritten);return true;
 }
 const type=r.headers.get('content-type')||'application/octet-stream';
 const headers={'content-type':type,'cache-control':'private, no-store','access-control-allow-origin':'*',
   'accept-ranges':r.headers.get('accept-ranges')||'bytes','x-content-type-options':'nosniff'};
 for(const k of ['content-range','content-length'])if(r.headers.has(k))headers[k]=r.headers.get(k);
 res.writeHead(r.status,headers);
 if(r.body)Readable.fromWeb(r.body).on('error',()=>res.destroy()).pipe(res);else res.end();
 return true;
}
