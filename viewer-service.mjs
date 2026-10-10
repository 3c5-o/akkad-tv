import crypto from 'node:crypto';
const raise=(message,status=400)=>{const e=new Error(message);e.status=status;throw e};
const usernamePattern=/^[a-z0-9_]{3,32}$/;
const uuidPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function viewerEmail(username,secret){
 if(!usernamePattern.test(username))raise('اسم المستخدم يجب أن يكون 3–32 حرفاً إنجليزياً أو رقماً',400);
 if(!/^[a-f0-9]{64}$/i.test(secret||''))raise('AKKAD_USERNAME_SECRET غير مهيأ على الخادم',503);
 const digest=crypto.createHmac('sha256',Buffer.from(secret,'hex')).update(username).digest('hex').slice(0,40);
 return 'viewer-'+digest+'@users.akkad.invalid';
}
export async function viewerRoutes({req,res,p,json,auth,readBody,apiRequest}){
 if(p!=='/api/auth/username'&&!p.startsWith('/api/admin/viewers'))return false;
 const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
 const adminApi=async(url,opts={})=>{
  if(!serviceKey)raise('إنشاء حسابات المستخدمين يحتاج SUPABASE_SERVICE_ROLE_KEY داخل Railway فقط',503);
  return apiRequest(url,{...opts,token:serviceKey});
 };
 if(p==='/api/auth/username'){
  if(req.method!=='POST')raise('طريقة غير مسموحة',405);
  const input=await readBody(req),name=String(input.username||'').trim().toLowerCase();
  if(!usernamePattern.test(name)||typeof input.password!=='string'||input.password.length<8||input.password.length>256)raise('بيانات الدخول غير صحيحة',401);
  const email=viewerEmail(name,process.env.AKKAD_USERNAME_SECRET);
  let result;try{result=await apiRequest('/auth/v1/token?grant_type=password',{method:'POST',body:{email,password:input.password}})}
  catch{raise('اسم المستخدم أو كلمة المرور غير صحيحة',401)}
  if(!result?.user?.id||!result.access_token)raise('تعذر التحقق من الحساب',401);
  const rows=await apiRequest('/rest/v1/akkad_viewer_accounts?select=username,active&user_id=eq.'+result.user.id,{token:result.access_token});
  if(!rows?.[0]||rows[0].active!==true||rows[0].username.toLowerCase()!==name)raise('حساب المشاهد غير فعال',403);
  return json(res,200,{access_token:result.access_token,refresh_token:result.refresh_token,expires_in:result.expires_in});
 }
 const a=await auth(req,{admin:true});
 if(p==='/api/admin/viewers'&&req.method==='GET'){
  const parsed=new URL(req.url||'/api/admin/viewers','http://localhost');
  const offset=Number(parsed.searchParams.get('offset')||0);
  const limit=Number(parsed.searchParams.get('limit')||50);
  const search=String(parsed.searchParams.get('search')||'').trim();
  if(!Number.isInteger(offset)||offset<0||offset>100000||!Number.isInteger(limit)||limit<1||limit>100||search.length>64)raise('بحث المستخدمين غير صالح');
  const rows=await apiRequest('/rest/v1/rpc/akkad_admin_list_viewers',{method:'POST',token:a.token,
    body:{p_search:search,p_offset:offset,p_limit:limit}});
  return json(res,200,{items:rows||[],total:Number(rows?.[0]?.total_count||0),offset,limit});
 }
 if(a.role!=='super_admin')raise('مدير أساسي فقط',403);
 if(p==='/api/admin/viewers'&&req.method==='POST'){
  const input=await readBody(req),username=String(input.username||'').trim().toLowerCase(),password=input.password;
  if(!usernamePattern.test(username)||typeof password!=='string'||password.length<8||password.length>256)raise('اكتب يوزر 3–32 حرفاً وكلمة مرور 8 أحرف على الأقل');
  const existing=await apiRequest('/rest/v1/akkad_viewer_accounts?select=user_id&username=eq.'+username,{token:a.token});
  if(existing?.length)raise('اسم المستخدم مستخدم بالفعل',409);
  const email=viewerEmail(username,process.env.AKKAD_USERNAME_SECRET);
  const created=await adminApi('/auth/v1/admin/users',{method:'POST',body:{email,password,email_confirm:true}});
  if(!created?.id)raise('لم ينشئ Auth الحساب',502);
  try{
   await apiRequest('/rest/v1/akkad_viewer_accounts',{method:'POST',token:a.token,body:{user_id:created.id,username,display_name:String(input.display_name||username).slice(0,100),active:true}});
  }catch(e){await adminApi('/auth/v1/admin/users/'+created.id,{method:'DELETE'}).catch(()=>{});throw e}
  return json(res,201,{user_id:created.id,username,ok:true});
 }

 const active=/^\/api\/admin\/viewers\/([0-9a-f-]{36})\/activate$/.exec(p);
 if(active){
  if(a.role!=='super_admin')raise('تفعيل المشاهدين للمدير الأساسي فقط',403);
  if(req.method!=='POST')raise('طريقة غير مسموحة',405);
  const id=active[1];if(!uuidPattern.test(id))raise('معرف مستخدم غير صالح');
  const b=await readBody(req),days=Number(b.days);
  if(!Number.isInteger(days)||days<1||days>1095)raise('المدة يجب أن تكون من يوم إلى 1095 يوماً');
  const plan=b.plan_id==null||b.plan_id===''?null:b.plan_id;
  if(plan!==null&&!uuidPattern.test(plan))raise('معرّف الباقة غير صالح');
  const rows=await apiRequest('/rest/v1/rpc/akkad_admin_activate_viewer',{method:'POST',token:a.token,
    body:{p_user:id,p_days:days,p_plan:plan}});
  return json(res,200,{ok:true,subscription:rows?.[0]||rows});
 }
 const stop=/^\/api\/admin\/viewers\/([0-9a-f-]{36})\/subscription$/.exec(p);
 if(stop){
  if(a.role!=='super_admin')raise('تعديل الاشتراك للمدير الأساسي فقط',403);
  if(req.method!=='PATCH')raise('طريقة غير مسموحة',405);
  const id=stop[1];if(!uuidPattern.test(id))raise('معرف مستخدم غير صالح');
  const {status}=await readBody(req);
  if(status!=='paused')raise('يمكن إيقاف الاشتراك فقط من هنا');
  const rows=await apiRequest('/rest/v1/akkad_subscriptions?user_id=eq.'+id+'&status=eq.active',{method:'PATCH',token:a.token,body:{status:'paused'},
    extraHeaders:{Prefer:'return=representation'}});
  return json(res,200,{ok:true,changed:rows?.length||0});
 }

 const match=/^\/api\/admin\/viewers\/([a-f0-9-]{36})(\/password)?$/.exec(p);
 if(!match||!uuidPattern.test(match[1]))raise('مسار غير موجود',404);
 const id=match[1];
 if(match[2]){
  if(req.method!=='PATCH')raise('طريقة غير مسموحة',405);
  const {password}=await readBody(req);
  if(typeof password!=='string'||password.length<8||password.length>256)raise('كلمة مرور غير صالحة');
  await adminApi('/auth/v1/admin/users/'+id,{method:'PUT',body:{password}});
 }else if(req.method==='PATCH'){
  const {active}=await readBody(req);if(typeof active!=='boolean')raise('الحالة غير صحيحة');
  await apiRequest('/rest/v1/rpc/akkad_admin_suspend_viewer',{method:'POST',token:a.token,body:{p_user:id,p_suspend:!active}});
 }else if(req.method==='DELETE')await adminApi('/auth/v1/admin/users/'+id,{method:'DELETE'});
 else raise('طريقة غير مدعومة',405);
 return json(res,200,{ok:true});
}
