import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handleSourceAction, handlePreflight, validateEndpoint } from './source-manager.mjs';
import { adminExtras } from './admin-extras.mjs';
import { viewerRoutes } from './viewer-service.mjs';
import { startAutoImport } from './auto-import.mjs';
import { handleMedia } from './media-gateway.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3000);
const supaUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const apiKey = process.env.SUPABASE_PUBLISHABLE_KEY || '';
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const resources = {
  plans: { table:'akkad_plans', fields:['name','duration_days','max_devices','max_connections','kind','active'] },
  sources: { table:'akkad_sources', fields:['name','kind','endpoint','credential_ref','license_confirmed','enabled','allow_insecure_http'] },
  catalog: { table:'akkad_catalog', fields:['title','kind','category','description','poster_url','tmdb_id','release_year','published','source_id'] },
  streams: { table:'akkad_streams', fields:['item_id','label','media_url','media_type','priority','enabled'] },
  subscriptions: { table:'akkad_subscriptions', fields:['user_id','plan_id','starts_at','ends_at','status'] },
  devices: { table:'akkad_devices', fields:['user_id','device_hash','device_label','blocked'] },
  activations: { table:'akkad_activations', fields:['plan_id','note','disabled','expires_at'] }
};
const json = (res,status,data) => {
  res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','referrer-policy':'no-referrer'});
  res.end(JSON.stringify(data));
};
const headers = { 'apikey': apiKey, 'content-type':'application/json' };
async function apiRequest(endpoint, { method='GET', token, body, extraHeaders={} }={}) {
  if (!supaUrl || !apiKey) throw Object.assign(new Error('SUPABASE_NOT_CONFIGURED'),{status:503});
  const response = await fetch(supaUrl + endpoint,{
    method,headers:{...headers,...(token===process.env.SUPABASE_SERVICE_ROLE_KEY&&token?{apikey:token}:{}),...(token?{Authorization:'Bearer '+token}:{}),...extraHeaders},
    body: body === undefined ? undefined : JSON.stringify(body),
    signal:AbortSignal.timeout(12000)
  });
  const text = await response.text();
  let data; try { data = text ? JSON.parse(text) : null; } catch { data={message:'Unexpected upstream response'}; }
  if (!response.ok) throw Object.assign(new Error(data?.message || data?.msg || data?.error_description || data?.error || 'API error'),{status:response.status});
  return data;
}
const bearer = req => /^Bearer (.+)$/i.exec(req.headers.authorization||'')?.[1];
async function auth(req,{admin=false}={}) {
  const token = bearer(req);
  if (!token) throw Object.assign(new Error('تسجيل الدخول مطلوب'),{status:401});
  const user=await apiRequest('/auth/v1/user',{token});
  if(!user?.id || !uuidRe.test(user.id)) throw Object.assign(new Error('جلسة غير صالحة'),{status:401});
  const roles=await apiRequest('/rest/v1/akkad_admins?select=role&user_id=eq.' + user.id,{token});
  const role=roles?.[0]?.role||'user';
  if(admin && role==='user') throw Object.assign(new Error('صلاحية الإدارة مطلوبة'),{status:403});
  return {token,user,role};
}
async function readBody(req) {
  const chunks=[];let total=0;
  for await (const part of req) {total+=part.length;if(total>65536) throw Object.assign(new Error('Request too large'),{status:413});chunks.push(part);}
  let data;try {data=JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}');}catch{throw Object.assign(new Error('Invalid JSON'),{status:400});}
  if (!data || typeof data!=='object' || Array.isArray(data)) throw Object.assign(new Error('Object required'),{status:400});
  return data;
}
const allowed = (body,fields) => Object.fromEntries(Object.entries(body).filter(([k])=>fields.includes(k)));
async function serveFile(res,name) {
  const file=path.resolve(root,'public',name);
  const types={html:'text/html; charset=utf-8',css:'text/css; charset=utf-8',js:'text/javascript; charset=utf-8',svg:'image/svg+xml'};
  const suffix=path.extname(file).slice(1);
  try {const data=await fs.readFile(file);
    res.writeHead(200,{'content-type':types[suffix]||'application/octet-stream','cache-control':'no-cache','x-content-type-options':'nosniff','content-security-policy':"default-src 'self'; img-src 'self' https: data:; media-src https: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"});
    res.end(data);
  } catch {json(res,404,{error:'File not found'});}
}
async function route(req,res) {
  const url=new URL(req.url||'/', 'http://localhost');
  const p=url.pathname;
  if(req.method==='GET' && p==='/health') return json(res,200,{ok:true,service:'AKKAD CORE',supabase_configured:Boolean(supaUrl && apiKey)});
  if(p.startsWith('/api/watch/')||p.startsWith('/api/episodes/')||p.startsWith('/api/media/')||/^\/api\/free\/[^/]+\/(watch|episodes)\//.test(p))
    return handleMedia({req,res,p,url,auth,apiRequest,json});
  if(p==='/api/auth/username'||p.startsWith('/api/admin/viewers'))
    return viewerRoutes({req,res,p,json,auth,readBody,apiRequest});
  if(p.startsWith('/api/admin/extra/') || /^\/api\/free\/[A-Z0-9]{2,12}\/catalog$/.test(p))
    return adminExtras({req,res,p,json,auth,apiRequest,readBody});
  if(req.method==='GET' && (p==='/'||p==='/tv'||p==='/admin')) return serveFile(res,p==='/admin'?'admin.html':'tv.html');
  if(req.method==='GET' && p==='/hls.min.js') {
    try{const data=await fs.readFile(path.join(root,'node_modules','hls.js','dist','hls.min.js'));
      res.writeHead(200,{'content-type':'text/javascript; charset=utf-8','cache-control':'public, max-age=604800','x-content-type-options':'nosniff'});res.end(data);
    }catch{return json(res,503,{error:'HLS player not installed'});}return;
  }
  if(req.method==='GET' && ['/tv-gold.css','/akkad.css','/akkad.js','/control.css','/control.js','/brand.svg'].includes(p)) return serveFile(res,p.slice(1));
  if(req.method==='POST' && p==='/api/auth/login') {
    const body=await readBody(req);
    if(typeof body.email!=='string' || typeof body.password!=='string' || body.password.length>300) return json(res,400,{error:'Invalid credentials'});
    const reply=await apiRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email:body.email,password:body.password}});
    return json(res,200,{access_token:reply.access_token,refresh_token:reply.refresh_token,expires_in:reply.expires_in});
  }
  if(req.method==='POST' && p==='/api/auth/refresh') {
    const {refresh_token}=await readBody(req);
    if(typeof refresh_token!=='string' || refresh_token.length>2048) return json(res,400,{error:'Invalid refresh token'});
    const reply=await apiRequest('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token}});
    return json(res,200,{access_token:reply.access_token,refresh_token:reply.refresh_token,expires_in:reply.expires_in});
  }
  if(req.method==='GET' && p==='/api/session') {
    const a=await auth(req);
    const subs=await apiRequest('/rest/v1/akkad_subscriptions?select=id,starts_at,ends_at,status,plan_id&user_id=eq.'+a.user.id+'&order=ends_at.desc&limit=5',{token:a.token});
    const viewers=a.role==='user'?await apiRequest('/rest/v1/akkad_viewer_accounts?select=username,active&user_id=eq.'+a.user.id,{token:a.token}):[];
    return json(res,200,{id:a.user.id,username:viewers?.[0]?.username||null,active:a.role==='user'?viewers?.[0]?.active===true:true,role:a.role,subscriptions:subs});
  }
  if(req.method==='GET' && (p==='/api/catalog'||p==='/api/plans')) {
    const kind=(url.searchParams.get('kind')||'').toLowerCase();
    if(kind && !['live','movie','series','anime'].includes(kind)) return json(res,400,{error:'Invalid category'});
    const t=p==='/api/catalog'?'akkad_catalog':'akkad_plans';
    const viewer=t==='akkad_catalog'?await auth(req):null;
    if(viewer?.role==='user'){
      const rows=await apiRequest('/rest/v1/akkad_viewer_accounts?select=active&user_id=eq.'+viewer.user.id,{token:viewer.token});
      if(!rows?.[0]?.active) return json(res,403,{error:'حساب المستخدم غير مفعّل'});
    }
    const query=t==='akkad_catalog'?'?select=id,title,kind,category,description,poster_url,release_year&published=eq.true&order=created_at.desc&limit=200'+(kind?'&kind=eq.'+kind:''):'?select=id,name,duration_days,max_devices,max_connections,kind&active=eq.true&order=duration_days.asc';
    return json(res,200,await apiRequest('/rest/v1/'+t+query,{token:viewer?.token}));
  }
  if(req.method==='POST' && p==='/api/redeem'){
    const a=await auth(req);
    const body=await readBody(req);
    if(typeof body.code!=='string'||body.code.length>80) return json(res,400,{error:'Invalid code'});
    return json(res,200,await apiRequest('/rest/v1/rpc/akkad_redeem',{method:'POST',token:a.token,body:{p_code:body.code.trim()}}));
  }
  if(req.method==='GET' && p.startsWith('/api/play/')){
    const id=p.slice('/api/play/'.length);
    if(!uuidRe.test(id)) return json(res,400,{error:'Invalid media ID'});
    const a=await auth(req);
    return json(res,200,await apiRequest('/rest/v1/rpc/akkad_get_playback',{method:'POST',token:a.token,body:{p_item:id}}));
  }
  if(p==='/api/admin/sources/preflight'||p==='/api/admin/sources/verified-create'){
    return handlePreflight({req,res,p,admin:r=>auth(r,{admin:true}),apiRequest,readBody,json});
  }
  if(/^\/api\/admin\/sources\/[0-9a-f-]{36}\/(credentials|check|sync|jobs)$/.test(p)) {
    return handleSourceAction({req,res,p,admin:r=>auth(r,{admin:true}),apiRequest,readBody,json});
  }
  if(p.startsWith('/api/admin/')){
    const a=await auth(req,{admin:true});
    const parts=p.slice('/api/admin/'.length).split('/'); const name=parts[0];const id=parts[1];
    const cfg=resources[name];if(!cfg || (id && !uuidRe.test(id))) return json(res,404,{error:'Not found'});
    const base='/rest/v1/'+cfg.table;
    if(req.method==='GET' && !id) {
      const data=await apiRequest(base+'?select=*&order=created_at.desc&limit=200',{token:a.token});
      return json(res,200,data);
    }
    if(req.method==='POST' && !id) {
      const body=await readBody(req);
      const record=allowed(body,cfg.fields);
      if(name==='sources' && record.license_confirmed!==true) return json(res,400,{error:'يجب تأكيد ترخيص المصدر'});
      if(name==='sources'){
        try {
          const u=new URL(record.endpoint);
          const consent=record.allow_insecure_http===true;
          if(u.protocol==='http:' && !consent) return json(res,400,{error:'مصدر HTTP يتطلب تفعيل خيار الموافقة على اتصال غير مشفر'});
          if(u.protocol==='http:' && process.env.AKKAD_ALLOW_HTTP_SOURCES!=='true') return json(res,400,{error:'يجب تفعيل خيار HTTP في إعدادات خادم أكّد'});
          const clean=validateEndpoint(record.endpoint,u.hostname,{allowHttp:consent});
          record.endpoint=clean.toString().replace(/\/$/,'');
          record.allow_insecure_http=consent;
        }catch{return json(res,400,{error:'عنوان المصدر غير صالح: استخدم نطاقاً أو IP عاماً مع بروتوكول HTTP/HTTPS، بدون بيانات دخول بالرابط'});}
        delete record.credential_ref;
      }
      if(name==='sources') record.enabled=false;
      let newCode;
      if(name==='activations') {
        newCode='AKKAD-'+crypto.randomBytes(16).toString('hex').toUpperCase();
        record.code_hash=crypto.createHash('sha256').update(newCode).digest('hex');
      }
      const data=await apiRequest(base,{method:'POST',token:a.token,body:record,extraHeaders:{Prefer:'return=representation'}});
      return json(res,201,{item:Array.isArray(data)?data[0]:data,activation_code:newCode});
    }
    if(req.method==='PATCH' && id){
      const body=await readBody(req);const record=allowed(body,cfg.fields);
      if(name==='sources' && record.enabled===true) return json(res,400,{error:'Enable only after source verification'});
      if(name==='sources' && (record.endpoint!==undefined || record.allow_insecure_http!==undefined)) return json(res,400,{error:'أنشئ مصدراً جديداً عند تغيير البروتوكول أو عنوان الخادم'});
      const data=await apiRequest(base+'?id=eq.'+id,{method:'PATCH',token:a.token,body:record,extraHeaders:{Prefer:'return=representation'}});
      return json(res,200,{item:Array.isArray(data)?data[0]:data});
    }
    return json(res,405,{error:'Method not allowed'});
  }
  if(p.startsWith('/api/')) return json(res,404,{error:'Not found'});
  return json(res,404,{error:'Not found'});
}
http.createServer(async(req,res)=>{try{await route(req,res);}catch(err){const status=Number.isInteger(err.status)&&err.status>=400&&err.status<600?err.status:500;console.error('API',req.method,req.url,status,err.message);json(res,status,{error:status===500?'خطأ داخلي في الخادم':err.message});}}).listen(port,'0.0.0.0',()=>console.log('AKKAD CORE listening on',port));
startAutoImport({url:supaUrl,publishableKey:apiKey});
