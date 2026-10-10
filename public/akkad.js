(() => {
'use strict';
const $=(selector,root=document)=>root.querySelector(selector);
const $$=(selector,root=document)=>Array.from(root.querySelectorAll(selector));
const mode=document.body.dataset.app;
const sessionKey='akkad_session_v1',refreshKey='akkad_refresh_v1';
let token=sessionStorage.getItem(sessionKey)||'';
let refreshToken=sessionStorage.getItem(refreshKey)||'';
let refreshRequest=null;
let currentSession=null;
let catalog=[];
const records={};
function notice(message){const el=$('#toast');if(!el)return;el.textContent=message;el.classList.add('show');clearTimeout(notice.timer);notice.timer=setTimeout(()=>el.classList.remove('show'),4700);}
function h(text){return String(text??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));}
function thumb(url){return typeof url==='string'&&/^https:\/\//i.test(url)?url:null;}
function activeSub(){return currentSession?.subscriptions?.some(s=>s.status==='active'&&new Date(s.ends_at)>new Date()&&new Date(s.starts_at)<=new Date());}
async function refreshSession(){
 if(!refreshToken)return false;
 if(!refreshRequest){
  refreshRequest=(async()=>{
   try{
    const response=await fetch('/api/auth/refresh',{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({refresh_token:refreshToken})});
    if(!response.ok)throw new Error('refresh failed');
    const data=await response.json();
    if(!data.access_token||!data.refresh_token)throw new Error('invalid refresh response');
    token=data.access_token;refreshToken=data.refresh_token;
    sessionStorage.setItem(sessionKey,token);sessionStorage.setItem(refreshKey,refreshToken);
    return true;
   }catch{
    token='';refreshToken='';currentSession=null;
    sessionStorage.removeItem(sessionKey);sessionStorage.removeItem(refreshKey);
    return false;
   }
  })().finally(()=>{refreshRequest=null;});
 }
 return refreshRequest;
}
async function api(path,options={},retried=false){
 const headers={'content-type':'application/json',...(token?{Authorization:'Bearer '+token}:{})};
 const response=await fetch(path,{...options,headers:{...headers,...options.headers}});
 const data=await response.json().catch(()=>({error:'استجابة غير متوقعة'}));
 if(!response.ok){
  const message=String(data?.error||data?.message||'فشل الطلب');
  const expired=/(?:jwt.*expired|token.*expired|expired.*token|invalid jwt|token is expired|invalid claims)/i.test(message);
  if(!retried&&expired&&refreshToken&&await refreshSession())return api(path,options,true);
  if(expired){
    if(mode==='admin')$('#admin-login')?.classList.remove('hidden');
    else $('#tv-login')?.classList.remove('hidden');
    throw new Error('انتهت جلسة الدخول؛ سجل دخولك من جديد');
  }
  throw new Error(message);
 }
 return data;
}
async function login(form){
  const data=new FormData(form);
  const result=await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:data.get('email'),password:data.get('password')})});
  token=result.access_token;refreshToken=result.refresh_token||'';
  sessionStorage.setItem(sessionKey,token);
  if(refreshToken)sessionStorage.setItem(refreshKey,refreshToken);else sessionStorage.removeItem(refreshKey);
  currentSession=await api('/api/session');
  return data;
}
function logout(){token='';refreshToken='';currentSession=null;sessionStorage.removeItem(sessionKey);sessionStorage.removeItem(refreshKey);if(mode==='admin')$('#admin-login')?.classList.remove('hidden');else $('#tv-login')?.classList.remove('hidden');notice('تم تسجيل الخروج');}
function openTv(section){
  $$('.tv-section').forEach(el=>el.classList.toggle('active',el.dataset.tvSection===section));
  $$('[data-tv-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tvTab===section));
  if(['movie','series','anime','live'].includes(section))renderCatalog(section);
}
function messageBox(message){return '<div class="empty">'+h(message)+'</div>';}
function getCategories(items){const counts={};for(const item of items){const cat=item.category||'عام';counts[cat]=(counts[cat]||0)+1;}return counts;}
function itemsOf(kind){let items=catalog.filter(x=>x.kind===kind);const term=($('#tv-search')?.value||'').trim().toLocaleLowerCase();if(term)items=items.filter(x=>(x.title+' '+(x.category||'')).toLocaleLowerCase().includes(term));return items;}
function cardHtml(item){
  const image=thumb(item.poster_url);
  return '<button class="poster" data-play="'+h(item.id)+'"><div class="poster-cover">'+(image?'<img loading="lazy" alt="" src="'+h(image)+'"/>':'◉')+'</div><div class="poster-name">'+h(item.title)+'</div></button>';
}
function renderCatalog(kind,category='الكل'){
 if(kind==='live'){
   const items=itemsOf('live');
   const cats=getCategories(items);
   const catEl=$('#live-categories'),channelEl=$('#live-channels');
   if(!catEl||!channelEl)return;
   catEl.innerHTML='<button class="live-btn '+(category==='الكل'?'active':'')+'" data-category="الكل">الكل ('+items.length+')</button>'+Object.entries(cats).map(([k,v])=>'<button class="live-btn '+(category===k?'active':'')+'" data-category="'+h(k)+'">'+h(k)+' ('+v+')</button>').join('');
   const filtered=category==='الكل'?items:items.filter(x=>x.category===category);
   channelEl.innerHTML=filtered.length?filtered.map((it,i)=>'<button class="live-btn" data-play="'+h(it.id)+'">'+(i+1)+'. '+h(it.title)+'</button>').join(''):messageBox('لم تُضف قنوات منشورة بعد');
   $$('#live-categories [data-category]').forEach(el=>el.onclick=()=>renderCatalog('live',el.dataset.category));
   $$('#live-channels [data-play]').forEach(el=>el.onclick=()=>playItem(el.dataset.play));
   return;
 }
 const items=itemsOf(kind),counts=getCategories(items);
 const cats=$('#cat-'+kind),grid=$('#grid-'+kind),counter=$('#count-'+kind);
 if(!grid||!cats)return;
 if(counter)counter.textContent=items.length+' عنصر';
 cats.innerHTML='<h3>الفئات</h3><button class="category-btn '+(category==='الكل'?'active':'')+'" data-category="الكل">الكل <span>'+items.length+'</span></button>'+
 Object.entries(counts).map(([k,v])=>'<button class="category-btn '+(category===k?'active':'')+'" data-category="'+h(k)+'">'+h(k)+' <span>'+v+'</span></button>').join('');
 const filtered=category==='الكل'?items:items.filter(x=>x.category===category);
 grid.innerHTML=filtered.length?filtered.map(cardHtml).join(''):messageBox('لا يوجد محتوى منشور في هذا القسم بعد. ستظهر الأعمال عند إضافتها من الإدارة.');
 $$('#cat-'+kind+' [data-category]').forEach(el=>el.onclick=()=>renderCatalog(kind,el.dataset.category));
 $$('#grid-'+kind+' [data-play]').forEach(el=>el.onclick=()=>playItem(el.dataset.play));
}
async function playItem(id){
 try{
  if(!token){$('#tv-login').classList.remove('hidden');notice('سجّل دخولك لبدء المشاهدة');return;}
  if(!activeSub()&&currentSession?.role==='user'){notice('يجب تفعيل اشتراك VIP أولاً');return;}
  const links=await api('/api/play/'+encodeURIComponent(id));
  if(!Array.isArray(links)||links.length===0){notice('لا تتوفر مصادر تشغيل لهذا المحتوى حالياً');return;}
  const item=catalog.find(x=>x.id===id);
  openTv('live');
  $('#live-title').textContent=item?.title||'مشغل أكّد';
  $('#live-status').textContent='المصدر: '+links[0].label;
  const player=$('#live-player');player.replaceChildren();
  const video=document.createElement('video');video.controls=true;video.autoplay=true;video.playsInline=true;video.preload='metadata';
  if(['hls','dash','mp4','ts','mkv','other'].includes(links[0].media_type)){
    video.src=links[0].media_url;
  }
  player.append(video);
  video.play().catch(()=>notice('اضغط تشغيل إذا منع المتصفح التشغيل التلقائي'));
  video.addEventListener('error',()=>notice('تعذّر تشغيل الصيغة في هذا المتصفح. جرّب مشغلاً متوافقاً أو مصدرًا آخر.'));
 }catch(err){notice(err.message);}
}
async function loadCatalog(){
 try{
  const data=await api('/api/catalog');
  catalog=Array.isArray(data)?data:[];
  $('#tv-featured').innerHTML=catalog.length?catalog.slice(0,5).map(cardHtml).join(''):messageBox('مكتبة أكّد قيد التجهيز. المحتوى هنا حقيقي ويتزامن مع لوحة الإدارة.');
  $$('#tv-featured [data-play]').forEach(el=>el.onclick=()=>playItem(el.dataset.play));
  ['live','movie','series','anime'].forEach(k=>renderCatalog(k));
 }catch(e){notice('تعذّر جلب المكتبة: '+e.message);$('#tv-featured').innerHTML=messageBox('الخادم غير مهيأ أو مكتبة المحتوى غير متاحة');}
}
function refreshUser(){
 const t=$('#account-status'),p=$('#playlist-account');
 if(!currentSession){if(t)t.textContent='معاينة — يلزم حساب VIP';if(p)p.textContent='لم يتم تسجيل الدخول';return;}
 const sub=currentSession.subscriptions?.find(s=>s.status==='active'&&new Date(s.ends_at)>new Date());
 const status=sub?'VIP فعّال حتى '+new Date(sub.ends_at).toLocaleDateString('ar-IQ'):'لا يوجد اشتراك نشط';
 if(t)t.textContent=status;if(p)p.textContent=(currentSession.email||'')+' — '+status;
}
async function initTv(){
 $$('[data-tv-tab]').forEach(el=>el.addEventListener('click',()=>openTv(el.dataset.tvTab)));
 $('#tv-search').addEventListener('input',()=>['live','movie','series','anime'].forEach(k=>renderCatalog(k)));
 $('#tv-user').onclick=()=>{if(!token)$('#tv-login').classList.remove('hidden');else notice(currentSession?.email||'حساب أكّد');};
 $('#tv-guest').onclick=()=>{$('#tv-login').classList.add('hidden');notice('هذه معاينة، التشغيل يحتاج حساباً واشتراكاً');};
 $('#tv-login-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button[type=submit]');btn.disabled=true;try{
    const formData=await login(e.target);if(formData.get('activation')){
      await api('/api/redeem',{method:'POST',body:JSON.stringify({code:String(formData.get('activation')).trim()})});
      currentSession=await api('/api/session');notice('تم تفعيل الاشتراك');
    }
    $('#tv-login').classList.add('hidden');refreshUser();await loadCatalog();
  }catch(err){notice(err.message);}finally{btn.disabled=false;}};
 $('#setting-refresh').onclick=$('#playlist-refresh').onclick=()=>loadCatalog();
 $('#setting-login').onclick=()=>$('#tv-login').classList.remove('hidden');
 $('#setting-logout').onclick=logout;
 $('#setting-theme').onclick=()=>notice('المظهر الذهبي هو التصميم المعتمد');
 $('#setting-subtitles').onclick=()=>notice('الترجمة تعتمد على مسارات الفيديو');
 $('#setting-player').onclick=()=>notice('مشغل HTML5 الحالي؛ مشغل Media3 مخصص لتطبيق Android');
 $('#live-fullscreen').onclick=()=>$('#live-player video')?.requestFullscreen?.();
 await new Promise(r=>setTimeout(r,900));$('#splash').classList.add('hidden');
 if(token){try{currentSession=await api('/api/session');}catch{token='';sessionStorage.removeItem(sessionKey);}}
 refreshUser();if(!token)$('#tv-login').classList.remove('hidden');
 await loadCatalog();
}
const recordTitle={
 sources:r=>r.name+' • '+r.kind,
 catalog:r=>r.title+' • '+r.kind,
 activations:r=>(r.note||'كود VIP')+(r.used_by?' — مستخدم':' — غير مستخدم'),
 plans:r=>r.name+' • '+r.duration_days+' يوم',
 subscriptions:r=>(r.user_id||'')+' • '+r.status,
 streams:r=>r.label+' • '+r.media_type,
 devices:r=>r.device_label||r.device_hash
};
function recordDescription(section,r){
 if(section==='sources')return (r.enabled?'نشط':'معطّل')+(r.allow_insecure_http?' • HTTP مسموح':' • HTTPS')+' • '+r.endpoint+' • آخر فحص: '+(r.last_check_status||'لم يُفحص')+' • قنوات '+(r.live_count||0)+' / أفلام '+(r.movie_count||0)+' / مسلسلات '+(r.series_count||0)+(r.last_error?' • '+r.last_error:'');
 if(section==='catalog')return (r.published?'منشور':'مسودة')+' • '+r.category+' • '+(r.tmdb_id?'TMDb '+r.tmdb_id:'بدون TMDb');
 if(section==='activations')return 'تاريخ الإنشاء: '+new Date(r.created_at).toLocaleString('ar-IQ')+(r.disabled?' • موقوف':'');
 if(section==='plans')return 'نوع: '+r.kind+' • الأجهزة: '+r.max_devices+' • الاتصالات: '+r.max_connections+' • '+(r.active?'نشط':'متوقف');
 if(section==='subscriptions')return 'تنتهي: '+new Date(r.ends_at).toLocaleString('ar-IQ');
 if(section==='streams')return r.media_type;
 return '';
}
function renderRecords(section) {
 const root=$('[data-records="'+section+'"]');if(!root)return;
 const list=records[section]||[];
 root.innerHTML=list.length?list.map(r=>{
  const button=section==='catalog'?'<button class="btn small" data-toggle="'+h(r.id)+'" data-field="published" data-value="'+(!r.published)+'">'+(r.published?'إخفاء':'نشر')+'</button>':
    section==='plans'?'<button class="btn small" data-toggle="'+h(r.id)+'" data-field="active" data-value="'+(!r.active)+'">'+(r.active?'إيقاف':'تشغيل')+'</button>':
    section==='activations'?'<button class="btn small danger" data-toggle="'+h(r.id)+'" data-field="disabled" data-value="true">إيقاف</button>':
    section==='subscriptions'&&r.status==='active'?'<button class="btn small danger" data-toggle="'+h(r.id)+'" data-field="status" data-value="paused">إيقاف</button>':'';
  return '<div class="record"><div class="record-content"><div class="record-title">'+h(recordTitle[section](r))+'</div><div class="record-detail">'+h(recordDescription(section,r))+'</div></div>'+button+'</div>';
 }).join(''):messageBox('لا توجد عناصر في هذا القسم بعد');
 $$('[data-toggle]',root).forEach(btn=>btn.onclick=async()=>{
   try{const value=['true','false'].includes(btn.dataset.value)?btn.dataset.value==='true':btn.dataset.value;
    await api('/api/admin/'+section+'/'+btn.dataset.toggle,{method:'PATCH',body:JSON.stringify({[btn.dataset.field]:value})});
    notice('تم تحديث العنصر');await loadAdminSection(section);
   }catch(err){notice(err.message);}
 });
}
async function loadAdminSection(section){
 const data=await api('/api/admin/'+section);
 records[section]=Array.isArray(data)?data:[];
 renderRecords(section);
 if(section==='sources')fillSourceSelector();
 if(section==='plans')fillPlans();
}
function fillPlans(){
 for(const selector of ['#activation-plan','#sub-plan']){
 const select=$(selector);if(!select)continue;const old=select.value;
 select.innerHTML=(records.plans||[]).filter(p=>p.active).map(p=>'<option value="'+h(p.id)+'">'+h(p.name+' ('+p.duration_days+' يوم)')+'</option>').join('');
 if(old&&Array.from(select.options).some(o=>o.value===old))select.value=old;
 }
}
function openAdmin(section){
 $$('.admin-section').forEach(el=>el.classList.toggle('active',el.dataset.adminSection===section));
 $$('[data-admin-tab]').forEach(el=>el.classList.toggle('active',el.dataset.adminTab===section));
 if(records[section]===undefined&&['sources','catalog','activations','plans','subscriptions'].includes(section))loadAdminSection(section).catch(e=>notice(e.message));
}
async function refreshDashboard(){
 const names=['sources','catalog','plans','activations','subscriptions'];
 const results=await Promise.allSettled(names.map(k=>loadAdminSection(k)));
 for(let i=0;i<names.length;i++){const el=$('#stat-'+names[i]);if(el)el.textContent=results[i].status==='fulfilled'?String((records[names[i]]||[]).length):'!';}
 $('#stat-role').textContent=currentSession?.role==='super_admin'?'المدير الأساسي':'مدير';
 fillPlans();
 try {const health=await api('/health');$('#admin-health').textContent=health.supabase_configured?'API يعمل، اتصال Supabase مهيأ':'خادم API يعمل لكن متغيرات Supabase غير مضبوطة';}catch(e){$('#admin-health').textContent='تعذر اختبار صحة الخادم: '+e.message;}
}
function getTyped(form){
 const data={};
 for(const [k,v] of new FormData(form).entries()){if(v==='')continue;
  data[k]=['duration_days','max_devices','max_connections','tmdb_id','release_year','priority'].includes(k)?Number(v):v;
 }
 if(form.dataset.create==='sources'){
  data.license_confirmed=$('[name=license_confirmed]',form).checked;
  data.allow_insecure_http=$('[name=allow_insecure_http]',form).checked;
  if(/^http:\/\//i.test(String(data.endpoint||''))&&!data.allow_insecure_http)throw new Error('لإضافة مصدر HTTP فعّل خيار السماح بـHTTP بعد قراءة التحذير');
 }
 if(form.dataset.create==='catalog')data.published=false;
 if(form.dataset.create==='subscriptions' && data.ends_at) data.ends_at=new Date(data.ends_at).toISOString();
 return data;
}

function fillSourceSelector(){
 const select=$('#source-selected');if(!select)return;
 const old=select.value;
 select.replaceChildren();
 const placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='اختر مصدراً';select.append(placeholder);
 for(const source of records.sources||[]){
   const opt=document.createElement('option');opt.value=source.id;opt.textContent=source.name+' ('+source.kind+')';select.append(opt);
 }
 if(old&&Array.from(select.options).some(o=>o.value===old))select.value=old;
 else if(select.options.length>1)select.selectedIndex=1;
 select.dispatchEvent(new Event('change'));
}
function setupSourceTools(){
 const select=$('#source-selected');if(!select)return;
 const result=$('#source-action-result');
 const selected=()=>((records.sources||[]).find(s=>s.id===select.value));
 function change(){
   const source=selected(),m3u=source?.kind==='m3u';
   $('#source-tools [data-xtream-field]').forEach(el=>el.classList.toggle('hidden',m3u));
   $('#source-m3u-wrap').classList.toggle('hidden',!m3u);
   const status=source?.enabled?'مفعّل':'معطّل';
   result.textContent=source?'المصدر: '+source.name+' • '+status+' • آخر فحص: '+(source.last_check_status||'لم يفحص'):'اختر مصدر IPTV';
 }
 select.addEventListener('change',change);change();
 async function run(button,action,body){
   const source=selected();
   if(!source){notice('اختر مصدراً أولاً');return;}
   const buttons=$('#source-tools button');
   buttons.forEach(b=>b.disabled=true);
   result.textContent='جارٍ تنفيذ '+action+'...';
   try{
     const response=await api('/api/admin/sources/'+source.id+'/'+action,{method:action==='jobs'?'GET':'POST',...(body?{body:JSON.stringify(body)}:{})});
     if(action==='credentials'){
       $('#source-password').value='';
       $('#source-m3u-url').value='';
       result.textContent='نجح الفحص الحقيقي وتم حفظ بيانات الحساب مشفّرة. الحساب: '+(response.overview?.status||'نشط')+' • الصلاحية: '+(response.overview?.expires_at?new Date(response.overview.expires_at).toLocaleDateString('ar-IQ'):'غير محددة')+' • القنوات: '+(response.overview?.counts?.live??'لم تُقرأ')+' • الأفلام: '+(response.overview?.counts?.movie??'لم تُقرأ')+' • المسلسلات: '+(response.overview?.counts?.series??'لم تُقرأ');
     }else if(action==='check'){
       const data=response.overview||{};
       result.textContent='اتصال المصدر: '+(data.status||'ناجح')+
         (data.expires_at?' • الصلاحية: '+new Date(data.expires_at).toLocaleDateString('ar-IQ'):'')+
         (data.max_connections!=null?' • حد الاتصالات: '+data.max_connections:'')+
         (data.counts?' • عدد القنوات: '+(data.counts.live??'لم تُقرأ')+' • الأفلام: '+(data.counts.movie??'لم تُقرأ')+' • المسلسلات: '+(data.counts.series??'لم تُقرأ'):'')+(data.warnings?.length?'\nملاحظات: '+data.warnings.join('؛ '):'');
     }else if(action==='sync'){
       result.textContent=(response.complete?'اكتملت مزامنة هذا القسم':'نجحت مزامنة '+(body.kind||''))+' • تم تسجيل '+response.imported+' عنصر • المصدر يحتوي '+response.available+
         ' • موضع الدفعة التالية: '+(response.next_offset??0)+' • المزيد: '+(response.has_more?'نعم':'لا')+' • المتجاوز: '+(response.skipped||0)+
         ' • إجمالي المحفوظ للمصدر: '+JSON.stringify(response.stored||{})+
         '\nالمحتوى يبقى مسودة حتى تراجعه وتنشره في قسم المحتوى.';
     }else if(action==='jobs'){
       result.textContent=(response.jobs||[]).slice(0,8).map(j=>j.kind+' • '+j.status+' • '+j.imported_count+' عنصر • '+new Date(j.started_at).toLocaleString('ar-IQ')+(j.error_summary?' • '+j.error_summary:'')).join('\n')||'لا يوجد سجل مزامنة';
     }
     if(action==='sync')$('#source-sync-reset').checked=false;
     notice('اكتمل الطلب');
     if(['check','credentials','sync'].includes(action)){
       const detail=result.textContent;
       await loadAdminSection('sources');
       if(action==='sync')await loadAdminSection('catalog');
       select.value=source.id;change();
       result.textContent=detail;
     }
   }catch(err){result.textContent='تعذر إكمال '+action+': '+err.message;notice(err.message);}
   finally{buttons.forEach(b=>b.disabled=false);}
 }
 $('#source-save-credentials').onclick=()=>{
   const source=selected();if(!source){notice('اختر المصدر');return;}
   if(source.kind==='xtream')run(null,'credentials',{username:$('#source-username').value,password:$('#source-password').value});
   else if(source.kind==='m3u')run(null,'credentials',{playlist_url:$('#source-m3u-url').value});
   else notice('نوع المصدر غير مدعوم لهذه الخطوة');
 };
 $('#source-check').onclick=()=>{
   const s=selected();if(!s){notice('حدد المصدر أولاً');return;}
   const fresh=s.kind==='xtream'?($('#source-username').value||$('#source-password').value?{
      username:$('#source-username').value,password:$('#source-password').value
    }:undefined):($('#source-m3u-url').value?{playlist_url:$('#source-m3u-url').value}:undefined);
   run(null,'check',fresh);
 };
 $('#source-jobs').onclick=()=>run(null,'jobs');
 $('#source-sync').onclick=()=>run(null,'sync',{kind:$('#source-sync-kind').value,limit:Number($('#source-sync-limit').value),reset:$('#source-sync-reset').checked});
}


function setupSourcePreflight(){
 const form=$('form[data-create="sources"]'),button=$('#source-preflight'),result=$('#source-preflight-result');
 if(!form||!button||!result)return;
 const kindSelector=$('[name=kind]',form);
 function renderKind(){
  const xtream=kindSelector.value==='xtream',m3u=kindSelector.value==='m3u';
  $('[data-new-xtream]',form).forEach(el=>el.classList.toggle('hidden',!xtream));
  $('[data-new-m3u]',form).forEach(el=>el.classList.toggle('hidden',!m3u));
  button.disabled=!(xtream||m3u);
  const submit=$('button[type=submit]',form);
  if(submit)submit.textContent=(xtream||m3u)?'فحص وإضافة المصدر عند النجاح':'إضافة مصدر يدوي معطّل';
 }
 kindSelector.onchange=renderKind;renderKind();
 button.onclick=async()=>{
  if(!form.reportValidity())return;
  button.disabled=true;result.textContent='جارٍ فحص الاتصال والحساب والبحث عن القنوات والأفلام والمسلسلات...';
  try{
   const payload=getTyped(form);
   const response=await api('/api/admin/sources/preflight',{method:'POST',body:JSON.stringify(payload)});
   result.textContent=formatAccountReport(response.overview)+'\nلم تُحفظ بيانات الحساب بعد. اضغط «فحص وإضافة المصدر عند النجاح» لحفظه.';
   notice('نجح فحص الحساب الحقيقي');
  }catch(err){
   result.textContent='فشل الفحص: '+err.message+'\nلم يُضَف الحساب ولم تُحفظ كلمة المرور.';
   notice(err.message);
  }finally{button.disabled=false;}
 };
}
function formatAccountReport(overview){
 const v=overview||{},n=v.counts||{};
 const check=(number)=>number==null?'غير متاح من المزود':String(number);
 return 'الحالة: '+(v.status||'غير معروفة')+
  '\nانتهاء الحساب: '+(v.expires_at?new Date(v.expires_at).toLocaleString('ar-IQ'):'لم يحدد المزود تاريخاً')+
  '\nعدد الاتصالات المسموح: '+check(v.max_connections)+
  '\nالاتصالات الحالية: '+check(v.active_connections)+
  '\nالقنوات: '+check(n.live)+' • الأفلام: '+check(n.movie)+' • المسلسلات: '+check(n.series)+
  (v.warnings?.length?'\nملاحظات: '+v.warnings.join('؛ '):'')+'\n';
}

function setupStreamForm(){
 const section=$('[data-admin-section="catalog"]');if(!section)return;
 const holder=document.createElement('div');holder.className='panel admin-card';holder.innerHTML=
 '<h3>إضافة مصدر تشغيل إلى عمل</h3><p class="note">روابط HTTPS من مصادر مرخصة؛ لا تظهر في كتالوج الجمهور، وتتاح للمشترك بعد التحقق من الاشتراك.</p>'+
 '<form class="form-grid" id="stream-form"><div class="field"><label>معرّف المحتوى UUID</label><input class="input" name="item_id" required/></div>'+
 '<div class="field"><label>نوع الفيديو</label><select class="select" name="media_type"><option value="hls">HLS / m3u8</option><option value="dash">DASH</option><option value="mp4">MP4</option><option value="ts">MPEG-TS</option><option value="mkv">MKV</option><option value="other">أخرى</option></select></div>'+
 '<div class="field"><label>عنوان التشغيل HTTPS</label><input class="input" type="url" name="media_url" required/></div>'+
 '<div class="field"><label>اسم الجودة</label><input class="input" name="label" value="تلقائي"/></div>'+
 '<div class="form-actions"><button class="btn primary">حفظ رابط التشغيل</button></div></form>';
 section.insertBefore(holder,$('[data-records="catalog"]'));
 $('#stream-form').onsubmit=async e=>{e.preventDefault();const body=getTyped(e.target);if(!/^https:\/\//i.test(body.media_url)){notice('استخدم HTTPS');return;}
  try{await api('/api/admin/streams',{method:'POST',body:JSON.stringify(body)});notice('تم حفظ المصدر. فعّل نشر العمل عند اختباره.');e.target.reset();}catch(err){notice(err.message);}};
}
async function initAdmin(){
 $$('[data-admin-tab]').forEach(el=>el.addEventListener('click',()=>openAdmin(el.dataset.adminTab)));
 $('#admin-logout').onclick=logout;
 $('#admin-login-form').onsubmit=async e=>{e.preventDefault();const btn=e.target.querySelector('button');btn.disabled=true;try{
  await login(e.target);
  if(currentSession.role==='user'){logout();throw new Error('هذا الحساب ليس لديه صلاحية إدارة');}
  $('#admin-login').classList.add('hidden');await refreshDashboard();notice('تم تسجيل دخول الإدارة');
 }catch(err){notice(err.message);}finally{btn.disabled=false;}};
 $$('form[data-create]').forEach(form=>form.onsubmit=async e=>{
  e.preventDefault();const kind=form.dataset.create;const btn=form.querySelector('button[type=submit],button:not([type])');if(btn)btn.disabled=true;
  try{
    const body=getTyped(form);
    const verified=kind==='sources'&&['xtream','m3u'].includes(body.kind);
    const route=verified?'/api/admin/sources/verified-create':'/api/admin/'+kind;
    if(verified)$('#source-preflight-result').textContent='جارٍ اختبار الحساب ثم حفظه وتفعيله فقط بعد نجاح المصادقة...';
    const result=await api(route,{method:'POST',body:JSON.stringify(body)});
    notice(verified?'نجح الفحص وتم إنشاء مصدر نشط':'تم حفظ البيانات');
    if(verified)$('#source-preflight-result').textContent=formatAccountReport(result.overview)+'\nالمصدر مضاف ومفعّل. الآن اختره من القائمة لتبدأ المزامنة.';
    if(kind==='activations'&&result.activation_code){
      const el=$('#new-code-result');el.textContent='كود التفعيل الجديد — انسخه الآن: '+result.activation_code;
      const copy=document.createElement('button');copy.className='btn small';copy.textContent='نسخ الكود';copy.type='button';copy.onclick=()=>navigator.clipboard.writeText(result.activation_code).then(()=>notice('تم نسخ الكود')).catch(()=>notice('انسخ الكود يدوياً'));el.append(' ',copy);
    }
    form.reset();await loadAdminSection(kind);
    if(kind==='sources'){
      const chosen=result.item?.id;
      if(chosen&&$('#source-selected')){$('#source-selected').value=chosen;$('#source-selected').dispatchEvent(new Event('change'));}
      $('form[data-create="sources"] [name=kind]').dispatchEvent(new Event('change'));
    }
  }catch(err){if(kind==='sources')$('#source-preflight-result').textContent='فشل الفحص أو الحفظ: '+err.message+'\nإذا كان Xtream/M3U فلن يُضاف حساب جديد عند فشل الفحص.';notice(err.message);}finally{if(btn)btn.disabled=false;}
 });
 setupSourceTools();
 setupSourcePreflight();
 setupStreamForm();
 if(token){try{currentSession=await api('/api/session');}catch{token='';sessionStorage.removeItem(sessionKey);}}
 if(!currentSession||currentSession.role==='user'){$('#admin-login').classList.remove('hidden');return;}
 $('#admin-login').classList.add('hidden');await refreshDashboard();
}
if(mode==='tv')initTv().catch(e=>notice(e.message));
if(mode==='admin')initAdmin().catch(e=>notice(e.message));
})();