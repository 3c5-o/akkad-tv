(()=>{'use strict';
const $=s=>document.querySelector(s),$=(s,root=document)=>[...root.querySelectorAll(s)];
const key='akkad_session_v1',refreshKey='akkad_refresh_v1';
let token=sessionStorage.getItem(key)||'',refresh=sessionStorage.getItem(refreshKey)||'',pending=null;
let session=null,resources={sources:[],catalog:[],plans:[],subscriptions:[],activations:[]},currentSource=null,sourceFilter='all';
const safe=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const notice=t=>{const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>e.classList.remove('show'),4300)};
function fail(e,target){if(target){target.textContent=e.message;target.classList.add('error')}notice(e.message)}
function formObject(form){const out=Object.fromEntries(new FormData(form));for(const box of $$('input[type=checkbox]',form))out[box.name]=box.checked;return out}
function statusText(source){return source.enabled&&source.last_check_status==='ok'?'يعمل':'متوقف'}
async function renew(){
 if(!refresh)return false;
 if(!pending)pending=(async()=>{
  try{const r=await fetch('/api/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({refresh_token:refresh})});if(!r.ok)throw Error();
  const d=await r.json();token=d.access_token;refresh=d.refresh_token;sessionStorage.setItem(key,token);sessionStorage.setItem(refreshKey,refresh);return true}
  catch{token='';refresh='';sessionStorage.removeItem(key);sessionStorage.removeItem(refreshKey);return false}
 })().finally(()=>pending=null);
 return pending;
}
async function api(route,options={},retry=false){
 const h={'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})};
 const r=await fetch(route,{...options,headers:{...h,...options.headers}});
 const v=await r.json().catch(()=>({error:'تعذّر قراءة رد الخادم'}));
 if(!r.ok){
  const msg=String(v.error||v.message||'فشل الاتصال');
  if(!retry&&/(expired|invalid jwt|invalid claims)/i.test(msg)&&await renew())return api(route,options,true);
  if(r.status===401&&route!=='/api/auth/login'){logout();throw Error('انتهت الجلسة، سجل دخول الإدارة مجدداً')}
  throw Error(msg);
 }
 return v;
}
function logout(){token='';refresh='';session=null;sessionStorage.removeItem(key);sessionStorage.removeItem(refreshKey);$('#admin-login').classList.remove('hidden')}
function switchTo(view){
 $$('.ctrl-section').forEach(x=>x.classList.toggle('active',x.dataset.view===view));
 $$('[data-section]').forEach(x=>x.classList.toggle('selected',x.dataset.section===view));
 const title={overview:'لوحة التحكم',sources:'مزودو IPTV',catalog:'مكتبة المحتوى',users:'حسابات المشاهدين',plans:'الاشتراكات والباقات',codes:'أكواد VIP',tmdb:'TMDb والمعلومات',settings:'النظام والإعدادات'};
 $('#ctrl-title').textContent=title[view]||title.overview;
 if(view==='tmdb')loadTmdb().catch(e=>notice(e.message));
 if(view==='users')loadViewers().catch(e=>notice(e.message));
 if(view==='settings')loadStatus().catch(e=>notice(e.message));
 window.scrollTo({top:0,behavior:'instant'});
}
const item=(title,details,actions='')=>'<div class="ctrl-item"><div><div class="ctrl-item-title">'+safe(title)+'</div><div class="ctrl-item-sub">'+safe(details)+'</div></div>'+actions+'</div>';
const empty=message=>'<div class="empty">'+safe(message)+'</div>';
async function refreshAll(){
 const names=['sources','catalog','plans','subscriptions','activations'];
 const results=await Promise.allSettled(names.map(x=>api('/api/admin/'+x)));
 for(let i=0;i<names.length;i++){if(results[i].status==='fulfilled')resources[names[i]]=Array.isArray(results[i].value)?results[i].value:[];else notice(names[i]+': '+results[i].reason.message)}
 renderAll();
 try{const health=await api('/health');$('#ctrl-health').textContent=health.ok?'خادم أكّد متصل':'الخادم غير متاح';$('#ctrl-health').classList.toggle('ok',health.ok)}
 catch{$('#ctrl-health').textContent='تعذر فحص الخادم'}
}
function renderAll(){renderStats();renderSources();renderCatalog();renderPlans();renderCodes()}
function renderStats(){
 const {sources,catalog,plans,subscriptions}=resources;
 const online=sources.filter(x=>x.enabled&&x.last_check_status==='ok');
 const numbers={'metric-online':online.length,'metric-offline':sources.length-online.length,'metric-catalog':catalog.length,'metric-published':catalog.filter(x=>x.published).length,'metric-plans':plans.length,'metric-subs':subscriptions.length};
 for(const [id,value] of Object.entries(numbers))$('#'+id).textContent=String(value);
 const overview=$('#overview-sources');
 overview.innerHTML=sources.length?sources.slice(0,7).map(s=>item(s.name,statusText(s)+' • '+(s.last_check_status||'never')+' • '+s.endpoint)).join(''):empty('لا توجد مصادر بعد');
 $('#overview-service').innerHTML='<div>API: <strong class="gold">AKKAD CORE</strong></div><div>قائمة المصادر: '+sources.length+'</div><div>المحتوى المنشور: '+numbers['metric-published']+'</div><div>الباقات: '+plans.length+'</div>';
 $('#src-all').textContent=sources.length;$('#src-online').textContent=online.length;$('#src-offline').textContent=sources.length-online.length;
}
function renderSources(){
 const sources=resources.sources.filter(x=>sourceFilter==='all'||(sourceFilter==='online'?(x.enabled&&x.last_check_status==='ok'):!(x.enabled&&x.last_check_status==='ok')));
 $('#source-records').innerHTML=sources.length?sources.map(s=>{
  const active=s.enabled&&s.last_check_status==='ok',expiry=s.provider_expires_at?new Date(s.provider_expires_at).toLocaleDateString('ar-IQ'):'غير محدد';
  return '<div class="provider-card '+(active?'active':'')+'"><div class="provider-header"><h3>'+safe(s.name)+'</h3><span class="status">'+(active?'متصل':'متوقف')+'</span></div><div class="provider-url">'+safe(s.endpoint)+'</div><div class="muted small">'+safe(s.kind.toUpperCase())+' • آخر فحص: '+safe(s.last_check_status||'never')+' • الصلاحية: '+safe(expiry)+'</div>'+
   '<div class="provider-meta"><div><strong>'+Number(s.live_count||0)+'</strong><span>قناة</span></div><div><strong>'+Number(s.movie_count||0)+'</strong><span>فيلم</span></div><div><strong>'+Number(s.series_count||0)+'</strong><span>مسلسل</span></div></div>'+
   '<div class="muted small">'+(s.free_enabled?'الكود المجاني: '+safe(s.free_code):'بدون كود مجاني')+' • '+(s.auto_import?'مزامنة تلقائية مفعّلة':'مزامنة يدوية')+'</div>'+
   (s.last_error?'<p class="muted small">'+safe(s.last_error)+'</p>':'')+
   '<div class="provider-actions"><button class="btn small" data-edit-source="'+safe(s.id)+'">إدارة وتعديل</button><button class="btn small ghost" data-inspect-source="'+safe(s.id)+'">فحص مجدداً</button></div></div>';
 }).join(''):empty('لا توجد مصادر في هذه الحالة');
 $$('[data-edit-source]').forEach(x=>x.onclick=()=>chooseSource(x.dataset.editSource,true));
 $$('[data-inspect-source]').forEach(x=>x.onclick=()=>{chooseSource(x.dataset.inspectSource,true);inspectSource()});
}
function chooseSource(id,scroll){
 currentSource=resources.sources.find(x=>x.id===id)||null;if(!currentSource)return;
 const s=currentSource,form=$('#source-edit-form');
 for(const field of ['name','free_code','auto_interval_minutes'])if(form.elements[field])form.elements[field].value=s[field]??'';
 for(const field of ['enabled','free_enabled','auto_import','auto_publish'])form.elements[field].checked=s[field]===true;
 form.elements.id.value=id;$('#source-editor-label').value=s.name+' • '+s.kind+' • '+statusText(s);
 const xt=s.kind==='xtream';
 $$('[data-xtream-edit]').forEach(x=>x.classList.toggle('hidden',!xt));
 $$('[data-m3u-edit]').forEach(x=>x.classList.toggle('hidden',xt));
 $('#source-edit-result').textContent='المصدر: '+s.endpoint+' • '+(s.last_error||s.last_check_status||'غير مفحوص');
 $('#source-edit-result').classList.remove('error');
 if(scroll)$('#edit-source-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function inspectSource(){
 if(!currentSource)return notice('حدد المزوّد أولاً');
 const b=currentSource.kind==='xtream'?{username:$('#existing-username').value,password:$('#existing-password').value}:{playlist_url:$('#existing-m3u').value};
 const supplied=currentSource.kind==='xtream'?Boolean(b.username||b.password):Boolean(b.playlist_url);
 const result=$('#source-edit-result');result.textContent='جارٍ فحص الحساب الحقيقي...';result.classList.remove('error');
 try{
  const data=await api('/api/admin/sources/'+currentSource.id+'/check',{method:'POST',body:JSON.stringify(supplied?b:{})});
  const n=data.overview?.counts||{};
  result.textContent='حالة الحساب: '+(data.overview?.status||'نشط')+
   '\nالقنوات: '+(n.live??'غير متاح')+' • الأفلام: '+(n.movie??'غير متاح')+' • المسلسلات: '+(n.series??'غير متاح')+
   '\nانتهاء الصلاحية: '+(data.overview?.expires_at?new Date(data.overview.expires_at).toLocaleDateString('ar-IQ'):'غير محددة');
  $('#existing-password').value='';$('#existing-m3u').value='';
  notice('فحص المصدر نجح');await refreshAll();chooseSource(currentSource.id,false);
 }catch(e){fail(e,result)}
}
function renderCatalog(){
 const kind=$('#catalog-type').value,term=$('#catalog-search').value.trim().toLowerCase();
 const entries=resources.catalog.filter(x=>(!kind||x.kind===kind)&&(!term||x.title.toLowerCase().includes(term)));
 $('#catalog-records').innerHTML=entries.length?entries.slice(0,200).map(x=>item(x.title,x.kind+' • '+x.category+' • '+(x.published?'منشور':'مسودة'),'<div class="ctrl-item-actions"><button class="btn small" data-publish="'+safe(x.id)+'">'+(x.published?'إخفاء':'نشر')+'</button></div>')).join(''):empty('لا توجد عناصر مطابقة');
 $$('[data-publish]').forEach(b=>b.onclick=async()=>{
  const i=resources.catalog.find(x=>x.id===b.dataset.publish);
  try{await api('/api/admin/catalog/'+i.id,{method:'PATCH',body:JSON.stringify({published:!i.published})});notice('تم تحديث النشر');await refreshAll()}catch(e){notice(e.message)}
 });
}
function renderPlans(){
 $('#plan-records').innerHTML=resources.plans.length?resources.plans.map(x=>item(x.name,x.duration_days+' يوماً • '+x.kind+' • '+x.max_devices+' أجهزة',x.active?'<div class="ctrl-item-actions"><button class="btn small" data-plan-off="'+safe(x.id)+'">إيقاف</button></div>':'')).join(''):empty('لا توجد باقات');
 $$('[data-plan-off]').forEach(x=>x.onclick=async()=>{
  if(!confirm('إيقاف الباقة الجديدة؟'))return;
  try{await api('/api/admin/plans/'+x.dataset.planOff,{method:'PATCH',body:JSON.stringify({active:false})});await refreshAll()}catch(e){notice(e.message)}
 });
 $('#subscription-records').innerHTML=resources.subscriptions.length?resources.subscriptions.map(x=>item(x.user_id,x.status+' • تنتهي '+new Date(x.ends_at).toLocaleDateString('ar-IQ'))).join(''):empty('لا توجد اشتراكات');
 const sel=$('#code-plan');const saved=sel.value;sel.replaceChildren();
 for(const p of resources.plans.filter(x=>x.active)){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+' ('+p.duration_days+' يوم)';sel.append(option)}
 if(saved&&[...sel.options].some(o=>o.value===saved))sel.value=saved;
}
function renderCodes(){
 $('#activation-records').innerHTML=resources.activations.length?resources.activations.map(x=>item(x.note||'كود VIP',x.used_at?'مستخدم':'غير مستخدم'+' • '+new Date(x.created_at).toLocaleDateString('ar-IQ'))).join(''):empty('لا توجد أكواد');
}
async function loadViewers(){
 const root=$('#viewer-records');
 try{
  const list=await api('/api/admin/viewers');
  root.innerHTML=list.length?list.map(v=>item(v.username,v.active?'نشط':'متوقف',
   '<div class="ctrl-item-actions"><button class="btn small" data-viewer-state="'+safe(v.user_id)+'">'+(v.active?'إيقاف':'تفعيل')+'</button><button class="btn small danger" data-viewer-delete="'+safe(v.user_id)+'">حذف</button></div>')).join(''):empty('لم تُنشأ حسابات مستخدمين بعد.');
  $('[data-viewer-state]').forEach(b=>b.onclick=async()=>{
   const entry=list.find(v=>v.user_id===b.dataset.viewerState);
   try{await api('/api/admin/viewers/'+entry.user_id,{method:'PATCH',body:JSON.stringify({active:!entry.active})});notice('تم تعديل الحساب');await loadViewers()}catch(e){notice(e.message)}
  });
  $('[data-viewer-delete]').forEach(b=>b.onclick=async()=>{
   if(!confirm('حذف هذا الحساب نهائياً؟'))return;
   try{await api('/api/admin/viewers/'+b.dataset.viewerDelete,{method:'DELETE'});notice('تم حذف الحساب');await loadViewers()}catch(e){notice(e.message)}
  });
 }catch(e){root.innerHTML=empty('تعذّر جلب الحسابات: '+e.message)}
}

async function loadTmdb(){
 try{const v=await api('/api/admin/extra/tmdb');$('#tmdb-status').textContent=v.configured?'TMDb مربوط ومفتاحه مخزّن مشفّراً.':'أضف مفتاح TMDb أولاً.';$('#tmdb-status').classList.remove('error')}
 catch(e){fail(e,$('#tmdb-status'))}
}
async function loadStatus(){
 try{const v=await api('/health');$('#system-connection').textContent='AKKAD CORE: '+(v.ok?'متصل':'غير متصل')+' • Supabase: '+(v.supabase_configured?'مهيأ':'غير مهيأ')}
 catch(e){$('#system-connection').textContent=e.message}
}
async function setup(){
 $$('[data-section]').forEach(b=>b.onclick=()=>switchTo(b.dataset.section));
 $$('[data-goto]').forEach(b=>b.onclick=()=>switchTo(b.dataset.goto));
 $$('[data-source-filter]').forEach(b=>b.onclick=()=>{sourceFilter=b.dataset.sourceFilter;$$('[data-source-filter]').forEach(x=>x.classList.toggle('active',x===b));renderSources()});
 $('#ctrl-reload').onclick=()=>refreshAll();$('#ctrl-logout').onclick=logout;
 $('#jump-add-source').onclick=()=>$('#add-source-panel').scrollIntoView({behavior:'smooth'});
 $('#catalog-reload').onclick=refreshAll;$('#catalog-search').oninput=renderCatalog;$('#catalog-type').onchange=renderCatalog;
 $('#source-create-form').elements.kind.onchange=()=>{
  const isXt=$('#source-create-form').elements.kind.value==='xtream';
  $$('[data-xtream]').forEach(x=>x.classList.toggle('hidden',!isXt));
  $$('[data-m3u]').forEach(x=>x.classList.toggle('hidden',isXt));
 };
 async function createSource(save){
  const form=$('#source-create-form'),status=$('#source-preflight-status'),body=formObject(form);
  if(!form.reportValidity())return;
  status.classList.remove('error');status.textContent='جارٍ فحص حساب المزود من الخادم...';
  try{
   const apiPath=save?'verified-create':'preflight',response=await api('/api/admin/sources/'+apiPath,{method:'POST',body:JSON.stringify(body)});
   const v=response.overview||{},counts=v.counts||{};
   status.textContent='الفحص ناجح • '+(v.status||'نشط')+'\nالقنوات '+(counts.live??'غير متاح')+' • الأفلام '+(counts.movie??'غير متاح')+' • المسلسلات '+(counts.series??'غير متاح')+
     (save?'\nتمت إضافة المصدر وتفعيله.':'\nلم تُحفظ كلمة المرور أو المصدر.');
   if(save){form.reset();await refreshAll();if(response.item?.id)chooseSource(response.item.id,false)}
  }catch(e){fail(e,status)}
 }
 $('#source-preflight').onclick=()=>createSource(false);
 $('#source-create-form').onsubmit=e=>{e.preventDefault();createSource(true)};
 $('#source-edit-form').onsubmit=async e=>{
  e.preventDefault();if(!currentSource)return notice('حدد مصدراً');
  const d=formObject(e.target);delete d.id;
  d.auto_interval_minutes=Number(d.auto_interval_minutes);
  try{
   await api('/api/admin/extra/source/'+currentSource.id,{method:'PATCH',body:JSON.stringify(d)});
   notice('تم تعديل المصدر');await refreshAll();chooseSource(currentSource.id,false);
  }catch(e){fail(e,$('#source-edit-result'))}
 };
 $('#source-delete').onclick=async()=>{
  if(!currentSource)return notice('حدد مصدراً');
  if(!confirm('هل تؤكد حذف المصدر «'+currentSource.name+'» وإيقاف عرض محتواه؟ لا يمكن التراجع.'))return;
  try{await api('/api/admin/extra/source/'+currentSource.id,{method:'DELETE'});currentSource=null;$('#source-editor-label').value='لم تحدد مصدراً';notice('تم حذف المزود');await refreshAll()}catch(e){notice(e.message)}
 };
 $('#source-check').onclick=inspectSource;
 $('#source-sync').onclick=async()=>{
  if(!currentSource)return notice('حدد مصدر IPTV');
  try{const data=await api('/api/admin/sources/'+currentSource.id+'/sync',{method:'POST',body:JSON.stringify({kind:$('#source-sync-kind').value,limit:10})});
   $('#source-edit-result').textContent='تمت معالجة '+data.imported+' عناصر، متاح لدى المزود '+data.available+'؛ المزيد: '+(data.has_more?'نعم':'لا');await refreshAll();
  }catch(e){fail(e,$('#source-edit-result'))}
 };
 $('#plan-form').onsubmit=async e=>{e.preventDefault();const b=formObject(e.target);b.duration_days=Number(b.duration_days);b.max_devices=Number(b.max_devices);b.max_connections=1;b.active=true;
  try{await api('/api/admin/plans',{method:'POST',body:JSON.stringify(b)});notice('تمت إضافة الباقة');e.target.reset();await refreshAll()}catch(e){notice(e.message)}};
 $('#activation-form').onsubmit=async e=>{e.preventDefault();try{const b=formObject(e.target),d=await api('/api/admin/activations',{method:'POST',body:JSON.stringify(b)});
  const result=$('#code-result');result.textContent='الكود الجديد، انسخه الآن: '+(d.activation_code||'لم يصل')+' — لا يظهر نص الكود مجدداً.';
  notice('تم إنشاء الكود');await refreshAll()}catch(e){fail(e,$('#code-result'))}};
 $('#tmdb-save').onclick=async()=>{
  const el=$('#tmdb-status');el.textContent='جارٍ اختبار المفتاح مع TMDb...';
  try{await api('/api/admin/extra/tmdb',{method:'POST',body:JSON.stringify({key:$('#tmdb-key').value})});
   $('#tmdb-key').value='';el.classList.remove('error');el.textContent='تم التحقق وحفظ المفتاح مشفراً';notice('تم ربط TMDb')}
  catch(e){fail(e,el)}
 };
 $('#tmdb-search').onclick=async()=>{
  const root=$('#tmdb-results');root.textContent='جارٍ البحث...';
  try{const d=await api('/api/admin/extra/tmdb/search',{method:'POST',body:JSON.stringify({title:$('#tmdb-title').value,kind:$('#tmdb-kind').value})});
   root.innerHTML=d.results?.length?d.results.map(i=>item(i.title,(i.release_year||'')+' • TMDb '+i.tmdb_id)).join(''):empty('لا توجد نتائج')}
  catch(e){fail(e,root)}
 };
 $('#viewer-create').onclick=async()=>{
  const output=$('#viewer-status'),username=$('#viewer-name').value,password=$('#viewer-password').value;
  output.textContent='جارٍ إنشاء حساب المشاهد بأمان...';output.classList.remove('error');
  try{
   const result=await api('/api/admin/viewers',{method:'POST',body:JSON.stringify({username,password})});
   $('#viewer-password').value='';output.textContent='تم إنشاء الحساب: '+result.username+'، ويمكن استخدامه بتطبيق المستخدم.';
   notice('تم إنشاء حساب المشاهد');await loadViewers();
  }catch(e){fail(e,output)}
 };
 $('#viewer-records').innerHTML=empty('افتح قسم المشاهدين لعرض الحسابات الحالية.');
 $('#admin-login-form').onsubmit=async e=>{
  e.preventDefault();const button=$('button',e.target);button.disabled=true;
  try{
   const f=formObject(e.target),reply=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:f.email,password:f.password})});
   token=reply.access_token;refresh=reply.refresh_token||'';sessionStorage.setItem(key,token);sessionStorage.setItem(refreshKey,refresh);
   session=await api('/api/session');if(session.role==='user')throw Error('هذا الحساب ليس مديراً');
   $('#ctrl-role').textContent=session.role==='super_admin'?'المدير الأساسي':'مدير';$('#admin-login').classList.add('hidden');await refreshAll();
  }catch(e){token='';refresh='';sessionStorage.removeItem(key);sessionStorage.removeItem(refreshKey);notice(e.message)}
  finally{button.disabled=false}
 };
 if(token)try{session=await api('/api/session');if(session.role==='user')throw Error();$('#ctrl-role').textContent=session.role==='super_admin'?'المدير الأساسي':'مدير';await refreshAll();$('#admin-login').classList.add('hidden')}catch{logout()}
 else $('#admin-login').classList.remove('hidden');
}
setup().catch(e=>notice(e.message));
})();