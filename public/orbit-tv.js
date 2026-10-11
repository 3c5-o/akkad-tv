/* AKKAD Orbit user-only enhancements. Core catalog, authentication and playback remain in akkad.js. */
(()=>{
 'use strict';
 if(document.body.dataset.app!=='tv')return;
 const $=s=>document.querySelector(s);
 const $$=(s,root=document)=>Array.from(root.querySelectorAll(s));
 const codeButton=$('#tv-select-code'),vipButton=$('#tv-select-vip');
 function loginMode(free){
  (free?$('#tv-use-code'):$('#tv-use-vip'))?.click();
  codeButton?.classList.toggle('active',free);
  vipButton?.classList.toggle('active',!free);
  codeButton?.setAttribute('aria-pressed',String(free));
  vipButton?.setAttribute('aria-pressed',String(!free));
  $('#login-heading').textContent=free?'التفعيل بالكود المجاني':'تسجيل دخول VIP';
  $('#login-description').textContent=free?'كل كود يعرض محتوى المزود المرتبط به فقط، دون مزامنة أو اختيار مصادر.':'حساب VIP يعرض محتوى جميع المزودين النشطين المتاحين.';
  if(free)$('#tv-source-code')?.focus();else $('#tv-username')?.focus();
 }
 codeButton?.addEventListener('click',()=>loginMode(true));
 vipButton?.addEventListener('click',()=>loginMode(false));
 $('#tv-use-code')?.addEventListener('click',()=>{codeButton?.classList.add('active');vipButton?.classList.remove('active');});
 $('#tv-use-vip')?.addEventListener('click',()=>{vipButton?.classList.add('active');codeButton?.classList.remove('active');});
 const safe=x=>String(x??'');
 const scope=()=>{
  const code=sessionStorage.getItem('akkad_free_source');
  if(code)return 'code:'+code;
  const username=($('#playlist-account')?.textContent||'').split(' — ')[0];
  return 'vip:'+username;
 };
 function storeKey(){return 'akkad_orbit_favorites:'+scope();}
 function favorites(){
  try{return JSON.parse(localStorage.getItem(storeKey())||'[]').filter(x=>x&&typeof x.id==='string').slice(0,300);}catch{return [];}
 }
 function save(list){try{localStorage.setItem(storeKey(),JSON.stringify(list.slice(0,300)));}catch{notify('تعذر حفظ المفضلة على الجهاز');}}
 function notify(msg){const toast=$('#toast');if(!toast)return;toast.textContent=msg;toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3600);}
 function isFav(id){return favorites().some(x=>x.id===id);}
 function flip(item){
  let list=favorites(),exists=list.some(x=>x.id===item.id);
  list=exists?list.filter(x=>x.id!==item.id):[item,...list];
  save(list);markFavorites();if(document.body.dataset.section==='favorites')renderFavorites();
 }
 function markFavorites(){
  $$('[data-orbit-fav]').forEach(btn=>{
   const yes=isFav(btn.dataset.orbitFav);
   btn.textContent=yes?'★':'☆';
   btn.setAttribute('aria-label',yes?'إزالة من قائمتي':'إضافة إلى قائمتي');
   btn.classList.toggle('is-fav',yes);
  });
 }
 function attachFavoriteButtons(){
  $$('[data-play]').forEach(el=>{
   if(el.closest('#grid-favorites,#grid-sports,#multiview-channels'))return;
   if(el.dataset.orbitDecorated)return;
   el.dataset.orbitDecorated='1';
   if(!el.classList.contains('poster'))return;
   const id=el.dataset.play,title=el.querySelector('.poster-name')?.textContent||'',poster=el.querySelector('img')?.getAttribute('src')||'';
   const wrap=document.createElement('div');wrap.className='poster-wrap';
   el.replaceWith(wrap);wrap.append(el);
   const btn=document.createElement('button');btn.type='button';btn.className='fav-toggle';btn.dataset.orbitFav=id;
   btn.onclick=()=>flip({id,title,poster});wrap.append(btn);
  });
  markFavorites();
 }
 function openItem(id){
  // Delegates playback to the already authenticated, source-scoped core viewer.
  const item=$$('[data-play]').find(x=>x.dataset.play===id&&!x.closest('#grid-favorites,#grid-sports'));
  if(item){item.click();return}
  notify('هذا العمل غير موجود ضمن محتوى مزودك الحالي');
 }
 function makeCard(item){
  const wrap=document.createElement('div');wrap.className='poster-wrap';
  const open=document.createElement('button');open.className='poster';open.type='button';
  const img=document.createElement('div');img.className='poster-cover';
  if(item.poster&&/^https:\/\//i.test(item.poster)){
   const image=document.createElement('img');image.src=item.poster;image.alt='';image.loading='lazy';img.append(image);
  }else img.textContent='◉';
  const name=document.createElement('div');name.className='poster-name';name.textContent=item.title;
  open.append(img,name);open.onclick=()=>openItem(item.id);wrap.append(open);
  const toggle=document.createElement('button');toggle.className='fav-toggle is-fav';toggle.textContent='★';toggle.setAttribute('aria-label','إزالة من قائمتي');
  toggle.onclick=()=>flip(item);wrap.append(toggle);
  return wrap;
 }
 function renderFavorites(){
  const grid=$('#grid-favorites');if(!grid)return;
  grid.replaceChildren();const list=favorites();
  if(!list.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='قائمتك فارغة. اضغط النجمة بجوار فيلم أو مسلسل لحفظه.';grid.append(empty);}
  else for(const item of list)grid.append(makeCard(item));
 }
 function renderSports(){
  const grid=$('#grid-sports');if(!grid)return;grid.replaceChildren();
  const live=$$('#live-channels [data-play]').filter(b=>/sport|beIN|ssc|رياض|كرة|مباراة|دوري/i.test(b.textContent||''));
  if(!live.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='لا تتوفر حالياً قنوات رياضية ظاهرة ضمن المزود. راجع تصنيفات البث المباشر.';grid.append(empty);return;}
  for(const b of live){
   const btn=document.createElement('button');btn.className='live-btn';btn.textContent=b.textContent;
   btn.onclick=()=>b.click();grid.append(btn);
  }
 }
 const streams=[];
 function stopMulti(){
  for(const m of streams){try{m.hls?.destroy();m.video.pause();m.video.removeAttribute('src');m.video.load();}catch{}}
  streams.length=0;drawMulti();
 }
 function drawMulti(){
  const grid=$('#multiview-grid'),picker=$('#multiview-channels');if(!grid||!picker)return;
  $('#multiview-counter').textContent=streams.length+' / 4';
  grid.replaceChildren();
  for(let i=0;i<4;i++){
   const m=streams[i],cell=document.createElement('div');cell.className='multi-cell'+(m&&!m.video.muted?' active':'');
   if(m){
    cell.append(m.video);const badge=document.createElement('span');badge.className='multi-badge';badge.textContent=m.title;cell.append(badge);
    const sound=document.createElement('button');sound.textContent=m.video.muted?'تفعيل الصوت':'كتم الصوت';
    sound.onclick=()=>{const target=!m.video.muted;for(const x of streams)x.video.muted=true;if(!target)m.video.muted=false;drawMulti();};cell.append(sound);
   }else cell.textContent='اختر قناة';
   grid.append(cell);
  }
  picker.replaceChildren();
  const channels=$$('#live-channels [data-play]').slice(0,150);
  for(const channel of channels){
   const btn=document.createElement('button');btn.textContent=channel.textContent;
   const id=channel.dataset.play;btn.disabled=streams.some(m=>m.id===id)||streams.length>=4;
   btn.onclick=()=>addMulti(id,channel.textContent);picker.append(btn);
  }
  if(!channels.length){const el=document.createElement('span');el.className='muted';el.textContent='سجّل الدخول وانتظر تحميل القنوات أولاً.';picker.append(el);}
 }
 async function addMulti(id,title){
  if(streams.length>=4)return notify('الحد الأعلى أربع قنوات');
  if(window.AkkadAndroid)return notify('المشغل الأصلي يعرض قناة واحدة؛ استخدم واجهة المتصفح لعدة قنوات');
  const [source,kind,external]=safe(id).split(':');if(kind!=='live'||!source||!/^\d+$/.test(external||''))return notify('معرف القناة غير صالح');
  const code=sessionStorage.getItem('akkad_free_source');
  const token=sessionStorage.getItem('akkad_session_v1');
  if(!code&&!token)return notify('سجّل الدخول أولاً');
  const base=code?'/api/instant/free/'+encodeURIComponent(code):'/api/instant/vip';
  const q=new URLSearchParams({source,kind,id:external});
  try{
   const response=await fetch(base+'/watch?'+q,{headers:token?{Authorization:'Bearer '+token}:{}});
   const payload=await response.json();
   if(!response.ok)throw new Error(payload.error||'تعذر فتح القناة');
   if(document.body.dataset.section!=='multiview')return;
   const video=document.createElement('video');video.controls=true;video.autoplay=true;video.playsInline=true;video.muted=true;video.preload='none';
   let hls=null;
   if(payload.format==='hls'&&window.Hls?.isSupported()){
    hls=new window.Hls({enableWorker:false,maxBufferLength:12});hls.loadSource(payload.url);hls.attachMedia(video);
   }else video.src=payload.url;
   streams.push({id,title,video,hls});drawMulti();video.play().catch(()=>notify('اضغط تشغيل لبدء القناة'));
  }catch(e){notify(e.message)}
 }
 $('#multiview-clear')?.addEventListener('click',stopMulti);
 const observe=['#tv-featured','#grid-movie','#grid-series','#live-channels'];
 for(const sel of observe){
  const root=$(sel);if(!root)continue;
  let scheduled=false;
  new MutationObserver(()=>{if(scheduled)return;scheduled=true;requestAnimationFrame(()=>{scheduled=false;attachFavoriteButtons();if(sel==='#live-channels'){if(document.body.dataset.section==='sports')renderSports();if(document.body.dataset.section==='multiview')drawMulti();}})}).observe(root,{childList:true,subtree:false});
 }
 document.addEventListener('click',event=>{
  const tab=event.target.closest('[data-tv-tab]');
  if(!tab)return;
  if(tab.dataset.tvTab==='favorites')renderFavorites();
  if(tab.dataset.tvTab==='sports')renderSports();
  if(tab.dataset.tvTab==='multiview')drawMulti();
 });
 let oldSection='';
 new MutationObserver(()=>{
  const next=document.body.dataset.section;
  if(next===oldSection)return;
  if(oldSection==='multiview'&&next!=='multiview')stopMulti();
  oldSection=next;
  if(next==='favorites')renderFavorites();
  if(next==='sports')renderSports();
  if(next==='multiview')drawMulti();
 }).observe(document.body,{attributes:true,attributeFilter:['data-section']});
 window.addEventListener('pagehide',stopMulti);
 attachFavoriteButtons();
})();
