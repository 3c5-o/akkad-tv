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
let freeSourceCode=sessionStorage.getItem('akkad_free_source')||'';
let currentHls=null,currentMpegts=null;
let catalog=[];
let loginByCode=false,activeSourceId='',sourceOptions=[];
const pageState={live:{loaded:0,hasMore:false,total:0},movie:{loaded:0,hasMore:false,total:0},series:{loaded:0,hasMore:false,total:0}};
let savedCodes=[];try{savedCodes=JSON.parse(sessionStorage.getItem('akkad_account_codes')||'[]').filter(x=>/^[A-Z0-9]{2,12}$/.test(x)).slice(0,30)}catch{}
let playbackRequest=0,catalogRequest=0;
let playerTarget='watch';
const selectedCategories={};
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
  const result=await api('/api/auth/username',{method:'POST',body:JSON.stringify({username:String(data.get('username')||'').trim(),password:data.get('password')})});
  token=result.access_token;refreshToken=result.refresh_token||'';
  sessionStorage.setItem(sessionKey,token);
  if(refreshToken)sessionStorage.setItem(refreshKey,refreshToken);else sessionStorage.removeItem(refreshKey);
  currentSession=await api('/api/session');
  return data;
}
function logout(){hideWatch();catalogRequest++;catalog=[];if(mode==='tv'){['live','movie','series'].forEach(k=>renderCatalog(k));$('#tv-featured').replaceChildren();}freeSourceCode='';sessionStorage.removeItem('akkad_free_source');token='';refreshToken='';currentSession=null;sessionStorage.removeItem(sessionKey);sessionStorage.removeItem(refreshKey);if(mode==='admin')$('#admin-login')?.classList.remove('hidden');else $('#tv-login')?.classList.remove('hidden');if(mode==='tv')refreshUser();notice('تم تسجيل الخروج');}
function openTv(section,record=true){
  if(!$('[data-tv-section="'+section+'"]'))return;
  document.body.dataset.section=section;hideWatch();
  if(record&&location.hash!=='#'+section)history.pushState({section},'', '#'+section);
  $$('.tv-section').forEach(el=>el.classList.toggle('active',el.dataset.tvSection===section));
  $$('[data-tv-tab]').forEach(el=>el.classList.toggle('active',el.dataset.tvTab===section));
  if(['movie','series','live'].includes(section))renderCatalog(section);
}
function messageBox(message){return '<div class="empty">'+h(message)+'</div>';}
function getCategories(items){const counts={};for(const item of items){const cat=item.category||'عام';counts[cat]=(counts[cat]||0)+1;}return counts;}
function itemsOf(kind){let items=catalog.filter(x=>x.kind===kind);const term=($('#tv-search')?.value||'').trim().toLocaleLowerCase();if(term)items=items.filter(x=>(x.title+' '+(x.category||'')).toLocaleLowerCase().includes(term));return items;}
function cardHtml(item){
  const image=thumb(item.poster_url);
  return '<button class="poster" data-play="'+h(item.id)+'"><div class="poster-cover">'+(image?'<img loading="lazy" alt="" src="'+h(image)+'"/>':'◉')+'</div><div class="poster-name">'+h(item.title)+'</div></button>';
}
function renderCatalog(kind,category=selectedCategories[kind]||'الكل'){
 selectedCategories[kind]=category;
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
function hideWatch(){
 playbackRequest++;
 if(currentHls){currentHls.destroy();currentHls=null;}
 for(const selector of ['#watch-video','#live-player']){
  const el=$(selector);if(!el)continue;
  const video=el.querySelector('video');
  if(video){video.pause();video.removeAttribute('src');video.load();}
  el.replaceChildren();
 }
 if($('#live-player'))$('#live-player').innerHTML='<span class="muted">اختر قناة لبدء التشغيل</span>';
 $('#tv-watch-modal')?.classList.add('hidden');
 playerTarget='watch';
}
function displayWatch(title,message=''){
 $('#tv-watch-modal')?.classList.remove('hidden');
 $('#watch-title').textContent=title||'مشغل أكّد';
 $('#watch-message').textContent=message;
 const episodes=$('#watch-episodes');episodes.replaceChildren();episodes.classList.add('hidden');
}
function setWatchStatus(status){$(playerTarget==='live'?'#live-status':'#watch-message').textContent=status;}
async function startVideo(url,format){
 if(currentHls){currentHls.destroy();currentHls=null}
 if(currentMpegts){currentMpegts.destroy();currentMpegts=null;}
 // Android TV: use the native Media3 player for HLS, MP4 and MKV streams.
  if(window.AkkadAndroid && typeof window.AkkadAndroid.playMedia==='function'){
    setWatchStatus('جارٍ فتح المشغل الأصلي…');
    try{
      window.AkkadAndroid.playMedia(new URL(url,location.origin).href,String(format||''),$('#watch-title')?.textContent||$('#live-title')?.textContent||'أكّد');
      return;
    }catch(error){setWatchStatus('تعذر فتح المشغل الأصلي: '+error.message);}
  }
  const element=$(playerTarget==='live'?'#live-player':'#watch-video');
 const oldVideo=element.querySelector('video');if(oldVideo){oldVideo.pause();oldVideo.removeAttribute('src');oldVideo.load();}element.replaceChildren();
 const video=document.createElement('video');video.controls=true;video.playsInline=true;video.autoplay=true;
 video.preload='metadata';video.setAttribute('aria-label','مشغل أكّد');
 element.append(video);
 video.addEventListener('playing',()=>setWatchStatus('يتم التشغيل الآن'));
 video.addEventListener('waiting',()=>setWatchStatus('جارٍ تحميل الفيديو…'));
 video.addEventListener('error',()=>setWatchStatus('فشل تشغيل الفيديو. قد لا يدعم المتصفح هذه الصيغة أو يكون رابط المزود متوقفاً.'));
 if(format==='hls'&&window.Hls?.isSupported()){
  currentHls=new window.Hls({enableWorker:false,maxBufferLength:25,maxMaxBufferLength:45,liveSyncDurationCount:3,backBufferLength:45});
  const instance=currentHls;instance.loadSource(url);instance.attachMedia(video);
  let networkRetries=0,mediaRetries=0;
  instance.on(window.Hls.Events.ERROR,(_event,detail)=>{
   if(!detail.fatal||instance!==currentHls)return;
   if(detail.type===window.Hls.ErrorTypes.NETWORK_ERROR&&networkRetries++<1){
    setWatchStatus('جارٍ إعادة الاتصال بالمزود…');instance.startLoad();return;
   }
   if(detail.type===window.Hls.ErrorTypes.MEDIA_ERROR&&mediaRetries++<1){
    setWatchStatus('محاولة إصلاح توافق ترميز الفيديو…');instance.recoverMediaError();return;
   }
   if(playerTarget==='live'){
    setWatchStatus('صيغة HLS غير متوفرة، جارٍ تجربة TS…');
    const fallback=url+(url.includes('?')?'&':'?')+'format=ts';
    startVideo(fallback,'ts');
    return;
   }
   setWatchStatus('المصدر لم يعمل: '+(detail.details||detail.type));
  });
 }else if(format==='ts'&&window.mpegts?.getFeatureList()?.mseLivePlayback){
  try{
   currentMpegts=window.mpegts.createPlayer({type:'mpegts',isLive:playerTarget==='live',url},{
     enableWorker:false,lazyLoad:false,autoCleanupSourceBuffer:true
   });
   currentMpegts.attachMediaElement(video);currentMpegts.load();
   currentMpegts.on(window.mpegts.Events.ERROR,(_type,detail)=>setWatchStatus('تعذر تشغيل TS: '+String(detail||'ترميز غير مدعوم')));
   currentMpegts.play().catch(()=>setWatchStatus('اضغط زر التشغيل لبدء بث TS'));
  }catch(e){setWatchStatus('تعذر تشغيل TS: '+e.message)}
  return;
 }else{
  video.src=url;
  if(format==='hls'&&!video.canPlayType('application/vnd.apple.mpegurl')){
   setWatchStatus('هذا المتصفح لا يدعم HLS؛ استخدم تطبيق Android TV');
  }
  if(format==='ts'&&!video.canPlayType('video/mp2t'))setWatchStatus('بث TS يتطلب متصفحاً يدعم MSE أو تطبيق Android TV');
 }
 video.play().catch(()=>setWatchStatus('اضغط زر تشغيل الفيديو إذا منع المتصفح التشغيل التلقائي.'));
}

function instantBase(){return freeSourceCode?'/api/instant/free/'+encodeURIComponent(freeSourceCode):'/api/instant/vip'}
async function playItem(id){
 const item=catalog.find(x=>x.id===id);if(!item)return notice('العمل غير موجود');
 if(!token&&!freeSourceCode){$('#tv-login').classList.remove('hidden');return;}
 if(item.kind==='live'&&document.body.dataset.section!=='live')openTv('live');
 hideWatch();const request=++playbackRequest;playerTarget=item.kind==='live'?'live':'watch';
 if(item.kind==='live'){$('#live-title').textContent=item.title;setWatchStatus('جارٍ تحميل القناة…')}
 else displayWatch(item.title,'جارٍ جلب الحلقات أو المشغل...');
 try{
  const [source,kind,external]=String(item.id).split(':');
  if(!source||!kind||!external)throw Error('معرف المحتوى غير صالح');
  const query=new URLSearchParams({source,kind,id:external});
  if(item.container_extension)query.set('ext',item.container_extension);
  const result=await api(instantBase()+(kind==='series'?'/episodes':'/watch')+'?'+query);
  if(request!==playbackRequest)return;
  if(kind==='series'){
   let count=0;const root=$('#watch-episodes');root.classList.remove('hidden');
   for(const season of result.seasons||[]){
    const header=document.createElement('h3');header.textContent='الموسم '+season.season;root.append(header);
    for(const ep of season.episodes||[]){
     const b=document.createElement('button');b.className='watch-episode';b.textContent=ep.title||'حلقة';
     b.onclick=()=>{setWatchStatus('جارٍ تشغيل '+b.textContent);startVideo(ep.url,ep.format==='m3u8'?'hls':ep.format)};root.append(b);count++;
    }
   }setWatchStatus(count?'اختر حلقة • العدد: '+count:'لم يرجع المصدر حلقات');
  }else{
   setWatchStatus('المصدر: '+result.label);await startVideo(result.url,result.format);
  }
 }catch(e){if(request!==playbackRequest)return;setWatchStatus('تعذّر التشغيل: '+e.message);notice(e.message)}
}
async function loadSourceOptions(){
 if(!token&&!freeSourceCode)return;
 const result=await api(instantBase()+'/sources');
 sourceOptions=result.sources||[];
 const sel=$('#playlist-source');sel.replaceChildren();
 if(token){
  const all=document.createElement('option');all.value='';all.textContent='جميع المزودين (VIP)';sel.append(all);
  for(const s of sourceOptions){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;sel.append(o)}
 }
 for(const code of savedCodes){const o=document.createElement('option');o.value='code:'+code;o.textContent='حساب الكود '+code;sel.append(o)}
 sel.value=freeSourceCode?'code:'+freeSourceCode:activeSourceId;
 $('#playlist-sources-info').textContent='المزودون: '+sourceOptions.length+' • الأكواد المضافة: '+savedCodes.length;
}
async function loadPage(kind,offset=0,request=catalogRequest){
 const q=new URLSearchParams({kind,offset:String(offset),limit:'150'});
 if(!freeSourceCode&&activeSourceId)q.set('source',activeSourceId);
 const data=await api(instantBase()+'/catalog?'+q);if(request!==catalogRequest)return;
 if(offset===0)catalog=catalog.filter(x=>x.kind!==kind);
 const ids=new Set(catalog.map(x=>x.id));
 const news=(data.items||[]).filter(x=>!ids.has(x.id));catalog.push(...news);
 pageState[kind]={loaded:offset+(data.items||[]).length,hasMore:data.has_more===true,total:data.total||0};
 const button=$('#more-'+kind);if(button)button.classList.toggle('hidden',!pageState[kind].hasMore);
 renderCatalog(kind);
 const count=$('#count-'+kind);if(count)count.textContent=pageState[kind].total+' عنصر';
}
async function loadCatalog(){
 const request=++catalogRequest;catalog=[];
 if(!token&&!freeSourceCode){
  $('#tv-featured').innerHTML=messageBox('أدخل كود الحساب أو سجّل VIP لعرض المحتوى.');
  for(const kind of ['live','movie','series'])renderCatalog(kind);return;
 }
 try{
  await loadSourceOptions();if(request!==catalogRequest)return;
  const result=await Promise.allSettled(['live','movie','series'].map(x=>loadPage(x,0,request)));
  if(request!==catalogRequest)return;
  $('#tv-featured').innerHTML=catalog.length?catalog.slice(0,5).map(cardHtml).join(''):messageBox('لا يوجد محتوى متاح أو تعذّر تحميله');
  $$('#tv-featured [data-play]').forEach(el=>el.onclick=()=>playItem(el.dataset.play));
  const failed=result.find(x=>x.status==='rejected');if(failed)notice('خطأ بجلب بعض القوائم: '+failed.reason.message);
 }catch(e){if(request!==catalogRequest)return;notice(e.message);$('#tv-featured').innerHTML=messageBox(e.message)}
}
function refreshUser(){
 const t=$('#account-status'),p=$('#playlist-account');
 if(freeSourceCode){if(t)t.textContent='حساب الكود: '+freeSourceCode;if(p)p.textContent='المصدر المختار بالكود: '+freeSourceCode;return;}
 if(!currentSession){if(t)t.textContent=freeSourceCode?'مصدر مجاني: '+freeSourceCode:'معاينة — يلزم حساب VIP';if(p)p.textContent=freeSourceCode?'المصدر المجاني: '+freeSourceCode:'لم يتم تسجيل الدخول';return;}
 const sub=currentSession.subscriptions?.find(s=>s.status==='active'&&new Date(s.ends_at)>new Date()&&new Date(s.starts_at)<=new Date());
 const status=sub?'VIP فعّال حتى '+new Date(sub.ends_at).toLocaleDateString('ar-IQ'):'لا يوجد اشتراك نشط';
 if(t)t.textContent=status;if(p)p.textContent=(currentSession.username||'المشاهد')+' — '+status;
}
async function fullscreen(element){
 try{if(element?.requestFullscreen)await element.requestFullscreen();else if(element?.webkitEnterFullscreen)element.webkitEnterFullscreen();else notice('ملء الشاشة غير مدعوم على هذا الجهاز');}catch{notice('تعذر فتح ملء الشاشة');}
}
function moveFocus(event){
 if(!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
 const current=document.activeElement;
 if(current?.matches('input,textarea,select,video'))return;
 const scope=!$('#tv-login').classList.contains('hidden')?$('#tv-login'):!$('#tv-watch-modal').classList.contains('hidden')?$('#tv-watch-modal'):document;
 const buttons=$$('button:not(:disabled),input,a[href]',scope).filter(el=>el.getClientRects().length);
 if(!buttons.length)return;
 if(!buttons.includes(current)){event.preventDefault();buttons[0].focus();return;}
 const box=current.getBoundingClientRect(),x=box.x+box.width/2,y=box.y+box.height/2;
 const horizontal=['ArrowLeft','ArrowRight'].includes(event.key),sign=['ArrowLeft','ArrowUp'].includes(event.key)?-1:1;
 const candidates=buttons.filter(el=>el!==current).map(el=>{const r=el.getBoundingClientRect(),dx=r.x+r.width/2-x,dy=r.y+r.height/2-y;return {el,forward:(horizontal?dx:dy)*sign,side:Math.abs(horizontal?dy:dx)};}).filter(c=>c.forward>1).sort((a,b)=>(a.forward+a.side*3)-(b.forward+b.side*3));
 if(candidates.length){event.preventDefault();candidates[0].el.focus();candidates[0].el.scrollIntoView({block:'nearest',inline:'nearest'});}
}
async function initTv(){
 document.addEventListener('keydown',moveFocus);
 document.body.dataset.section='home';
 window.addEventListener('popstate',()=>openTv(location.hash.slice(1)||'home',false));
 $('#tv-back').onclick=()=>openTv('home');
 window.addEventListener('offline',()=>notice('انقطع اتصال الإنترنت'));
 window.addEventListener('online',()=>{notice('عاد اتصال الإنترنت');loadCatalog();});
 $('#watch-close').onclick=hideWatch;
 $('#watch-fullscreen').onclick=()=>fullscreen($('#watch-video video')||$('#tv-watch-modal')); 
 document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!$('#tv-watch-modal').classList.contains('hidden'))hideWatch();else openTv('home');}});

 const setLoginMode=free=>{
  loginByCode=free;
  $('#tv-credentials-fields').classList.toggle('hidden',free);
  $('#tv-free-entry').classList.toggle('hidden',!free);
  $('#tv-use-code').classList.toggle('hidden',free);
  $('#tv-use-vip').classList.toggle('hidden',!free);
  $$('[name=username], [name=password]',$('#tv-login-form')).forEach(x=>x.required=!free);
  $('#tv-free-entry input').required=free;
  $('#tv-login-submit').textContent=free?'فتح حساب الكود':'دخول VIP';
 };
 $('#tv-use-code').onclick=()=>setLoginMode(true);
 $('#tv-use-vip').onclick=()=>setLoginMode(false);
 $$('[data-tv-tab]').forEach(el=>el.addEventListener('click',()=>openTv(el.dataset.tvTab)));
 $('#tv-search').addEventListener('input',()=>['live','movie','series'].forEach(k=>renderCatalog(k)));
 $('#tv-user').onclick=()=>{if(!token&&!freeSourceCode)$('#tv-login').classList.remove('hidden');else openTv('playlist');};

 $('#tv-login-form').onsubmit=async e=>{
  e.preventDefault();const button=$('#tv-login-submit');button.disabled=true;
  try{
   if(loginByCode){
    const code=String(new FormData(e.target).get('source_code')||'').trim().toUpperCase();
    if(!/^[A-Z0-9]{2,12}$/.test(code))throw Error('أدخل كوداً صحيحاً مثل A1');
    const result=await api('/api/instant/free/'+code+'/sources');
    if(!result.sources?.length)throw Error('الكود غير متاح');
    freeSourceCode=code;activeSourceId='';sessionStorage.setItem('akkad_free_source',code);
    if(!savedCodes.includes(code))savedCodes.push(code);
    sessionStorage.setItem('akkad_account_codes',JSON.stringify(savedCodes.slice(-30)));
    $('#tv-login').classList.add('hidden');refreshUser();await loadCatalog();notice('تم فتح حساب '+code);
   }else{
    freeSourceCode='';activeSourceId='';sessionStorage.removeItem('akkad_free_source');
    await login(e.target);$('#tv-login').classList.add('hidden');refreshUser();await loadCatalog();
   }
  }catch(err){notice(err.message)}finally{button.disabled=false}
 };
 $('#playlist-add-account').onclick=()=>{setLoginMode(true);$('#tv-login').classList.remove('hidden')};
 $('#playlist-source').onchange=async e=>{
  const next=e.target.value;
  if(next.startsWith('code:')){
   const code=next.slice(5);
   try{await api('/api/instant/free/'+code+'/sources');freeSourceCode=code;activeSourceId='';sessionStorage.setItem('akkad_free_source',code)}
   catch(err){return notice(err.message)}
  }else{
   if(!token)return notice('تحتاج تسجيل VIP للوصول إلى كل المزودين');
   freeSourceCode='';sessionStorage.removeItem('akkad_free_source');activeSourceId=next;
  }
  hideWatch();refreshUser();await loadCatalog();
 };
 $('#playlist-all-sources').onclick=async()=>{
  if(!token)return notice('سجّل VIP أولاً');
  freeSourceCode='';activeSourceId='';sessionStorage.removeItem('akkad_free_source');
  hideWatch();refreshUser();await loadCatalog();
 };
 for(const kind of ['live','movie','series'])$('#more-'+kind).onclick=async()=>{
  const b=$('#more-'+kind);b.disabled=true;
  try{await loadPage(kind,pageState[kind].loaded)}catch(e){notice(e.message)}finally{b.disabled=false}
 };
 $('#setting-refresh').onclick=$('#playlist-refresh').onclick=()=>loadCatalog();
 $('#setting-login').onclick=()=>$('#tv-login').classList.remove('hidden');
 $('#setting-logout').onclick=logout;
 $('#setting-theme').onclick=()=>{const compact=document.body.classList.toggle('compact-view');$('#setting-theme').textContent=compact?'العرض: مضغوط':'العرض: مريح';};
 $('#setting-subtitles').onclick=()=>notice('الترجمة تعتمد على مسارات الفيديو');
 $('#setting-player').onclick=()=>fullscreen(document.documentElement);
 $('#live-fullscreen').onclick=()=>{const video=$('#live-player video');if(video)fullscreen(video);else notice('اختر قناة أولاً');};
 await new Promise(r=>setTimeout(r,2200));$('#splash').classList.add('hidden');
 if(token){try{currentSession=await api('/api/session');}catch{token='';sessionStorage.removeItem(sessionKey);}}
 refreshUser();if(!token&&!freeSourceCode)$('#tv-login').classList.remove('hidden');else $('#tv-login').classList.add('hidden');
 await loadCatalog();
 openTv(location.hash.slice(1)||'home',false);
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