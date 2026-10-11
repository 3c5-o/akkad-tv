import crypto from 'node:crypto';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const usernamePattern=/^[a-z0-9_]{3,32}$/;
const bad=(message,status=400)=>Object.assign(new Error(message),{status});
export function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){
 return 'scrypt:'+salt+':'+crypto.scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex');
}
export function checkPassword(password,stored){
 if(typeof password!=='string'||password.length>256||!/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/.test(String(stored||'')))return false;
 const [_,salt,old]=stored.split(':');
 const actual=crypto.scryptSync(password,Buffer.from(salt,'hex'),64);
 return crypto.timingSafeEqual(actual,Buffer.from(old,'hex'));
}
const visible=a=>({id:a.id,username:a.username,expires_at:a.expires_at,active:a.active,
 max_connections:a.max_connections,source_ids:a.source_ids,created_at:a.created_at});
export async function adminXtreamAccounts({req,res,p,auth,readBody,apiRequest,json}){
 const match=/^\/api\/admin\/xtream-accounts(?:\/([0-9a-f-]{36}))?$/.exec(p);
 if(!match)return false;
 const me=await auth(req,{admin:true}),id=match[1];
 if(id&&!uuid.test(id))throw bad('معرف الحساب غير صحيح');
 const role=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!role)throw bad('SUPABASE_SERVICE_ROLE_KEY غير مهيأ',503);
 const db=(table,tail='',method='GET',body)=>apiRequest('/rest/v1/akkad_'+table+tail,{
   token:role,method,body,extraHeaders:method==='GET'?{}:{Prefer:'return=representation'}
 });
 const validateSources=async ids=>{
  if(!Array.isArray(ids)||ids.length>200||!ids.every(x=>uuid.test(x)))throw bad('معرفات المزودين غير صالحة');
  if(ids.length){
   const rows=await db('sources','?select=id,license_confirmed&id=in.('+ids.join(',')+')');
   if(rows.filter(x=>x.license_confirmed).length!==new Set(ids).size)throw bad('بعض المزودين غير مرخصين أو غير موجودين');
  }
  return [...new Set(ids)];
 };
 if(req.method==='GET'&&!id){
  const rows=await db('xtream_accounts','?select=*&order=created_at.desc&limit=300');
  return json(res,200,{items:rows.map(visible)});
 }
 if(req.method==='POST'&&!id){
  const b=await readBody(req);
  const username=String(b.username||'').trim().toLowerCase(),password=b.password;
  const days=Number(b.duration_days),connections=Number(b.max_connections||2);
  if(!usernamePattern.test(username)||typeof password!=='string'||password.length<8||password.length>256)
   throw bad('اسم المستخدم 3–32 حرفاً، وكلمة المرور 8 أحرف على الأقل');
  if(!Number.isInteger(days)||days<1||days>3650||!Number.isInteger(connections)||connections<1||connections>20)
   throw bad('مدة الحساب أو عدد الاتصالات غير صالح');
  const sourceIds=await validateSources(b.source_ids||[]);
  const expire=new Date(Date.now()+days*86400000).toISOString();
  const rows=await db('xtream_accounts','', 'POST',{username,password_hash:hashPassword(password),
   expires_at:expire,max_connections:connections,source_ids:sourceIds,created_by:me.user.id});
  return json(res,201,{item:visible(rows[0]),server_url:process.env.AKKAD_PUBLIC_XTREAM_BASE_URL||null});
 }
 if(!id)throw bad('طريقة غير مسموحة',405);
 if(req.method==='PATCH'){
  const b=await readBody(req),update={};
  if(typeof b.active==='boolean')update.active=b.active;
  if(b.duration_days!==undefined){
   const days=Number(b.duration_days);if(!Number.isInteger(days)||days<1||days>3650)throw bad('المدة غير صالحة');
   const rows=await db('xtream_accounts','?select=expires_at&id=eq.'+id);
   if(!rows.length)throw bad('الحساب غير موجود',404);
   update.expires_at=new Date(Math.max(Date.now(),new Date(rows[0].expires_at).getTime())+days*86400000).toISOString();
  }
  if(b.source_ids!==undefined)update.source_ids=await validateSources(b.source_ids);
  if(b.max_connections!==undefined){
   const n=Number(b.max_connections);if(!Number.isInteger(n)||n<1||n>20)throw bad('عدد الاتصالات غير صالح');update.max_connections=n;
  }
  if(b.password!==undefined){
   if(typeof b.password!=='string'||b.password.length<8||b.password.length>256)throw bad('كلمة المرور قصيرة');
   update.password_hash=hashPassword(b.password);
  }
  if(!Object.keys(update).length)throw bad('لم تحدد أي تعديل');
  update.updated_at=new Date().toISOString();
  const rows=await db('xtream_accounts','?id=eq.'+id,'PATCH',update);
  if(!rows.length)throw bad('الحساب غير موجود',404);
  return json(res,200,{item:visible(rows[0])});
 }
 if(req.method==='DELETE'){
  if(me.role!=='super_admin')throw bad('الحذف للمدير الأساسي فقط',403);
  await db('xtream_accounts','?id=eq.'+id,'DELETE');
  return json(res,200,{ok:true});
 }
 throw bad('طريقة غير مسموحة',405);
}
