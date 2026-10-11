import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const original=await readFile(new URL('../public/control.js',import.meta.url),'utf8');
const first=original.indexOf('const $=');
const last=original.indexOf('function switchTo(view)');
assert.ok(first>=0&&last>first);
const auth=original.slice(first,last);

function createFixture({stored={},fetchFn,native}={}){
 const map=new Map(Object.entries(stored));
 const elements=new Map();
 function element(id){
  if(!elements.has(id))elements.set(id,{
   textContent:'',disabled:false,
   classList:{state:new Set(),add(v){this.state.add(v)},remove(v){this.state.delete(v)},toggle(v,on){if(on===undefined?this.state.has(v):!on)this.state.delete(v);else this.state.add(v)}}
  });
  return elements.get(id);
 }
 const storage={getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,String(v)),removeItem:k=>map.delete(k)};
 const ctx={document:{querySelector:element,querySelectorAll:()=>[]},window:{AkkadAdminSession:native||null},
   sessionStorage:storage,fetch:fetchFn,clearTimeout,setTimeout,Date,Error,String,Number,Object,Promise};
 vm.runInNewContext(auth+';globalThis.__testAdmin={api,renew,logout,getToken:()=>token,getRefresh:()=>refresh};',ctx);
 return {api:ctx.__testAdmin.api,renew:ctx.__testAdmin.renew,logout:ctx.__testAdmin.logout,
 getToken:ctx.__testAdmin.getToken,getRefresh:ctx.__testAdmin.getRefresh,store:map,elements};
}
function response(status,data){return {ok:status>=200&&status<300,status,json:async()=>data};}

test('concurrent 401 requests refresh exactly once instead of logging out',async()=>{
 let refreshed=0,requested=0;
 const fixture=createFixture({
  stored:{akkad_admin_access_v2:'expired',akkad_admin_refresh_v2:'valid-refresh'},
  fetchFn:async(route,opts)=>{
   if(route==='/api/auth/refresh'){refreshed++;return response(200,{access_token:'fresh-token',refresh_token:'next-refresh',expires_in:3600});}
   requested++;
   return response(opts.headers.authorization==='Bearer fresh-token'?200:401,opts.headers.authorization==='Bearer fresh-token'?{ok:true}:{error:'jwt expired'});
  }
 });
 const answers=await Promise.all(Array.from({length:5},()=>fixture.api('/api/admin/sources')));
 assert.equal(answers.length,5);
 assert.ok(answers.every(x=>x.ok));
 assert.equal(refreshed,1);
 assert.equal(fixture.store.get('akkad_admin_refresh_v2'),'next-refresh');
 assert.ok(requested>=5);
 assert.equal(fixture.elements.has('#admin-login'),false); // no forced logout dialog was created
});

test('network failures leave the existing admin session intact',async()=>{
 const fixture=createFixture({stored:{akkad_admin_access_v2:'valid',akkad_admin_refresh_v2:'stored'},
  fetchFn:async()=>{throw new Error('offline')}});
 await assert.rejects(fixture.api('/api/admin/sources'),/فشل اتصال الشبكة/);
 assert.equal(fixture.store.get('akkad_admin_access_v2'),'valid');
 assert.equal(fixture.store.get('akkad_admin_refresh_v2'),'stored');
});

test('refresh token can be restored from native encrypted storage',async()=>{
 let saved='';
 const native={getRefreshToken:()=>'native-encrypted-token',saveRefreshToken:x=>{saved=x},clearRefreshToken:()=>{saved=''}};
 const fixture=createFixture({native,fetchFn:async(route)=>{
  assert.equal(route,'/api/auth/refresh');
  return response(200,{access_token:'restored',refresh_token:'rotated',expires_in:3600});
 }});
 assert.equal(await fixture.renew(),'ok');
 assert.equal(fixture.getToken(),'restored');
 assert.equal(saved,'rotated');
 fixture.logout();
 assert.equal(saved,'');
});

test('explicit logout clears both tokens',()=>{
 const fixture=createFixture({stored:{akkad_admin_access_v2:'access',akkad_admin_refresh_v2:'refresh'},
  fetchFn:async()=>response(200,{})});
 fixture.logout();
 assert.equal(fixture.store.has('akkad_admin_refresh_v2'),false);
 assert.equal(fixture.store.has('akkad_admin_access_v2'),false);
});
test('Android control keeps portrait screen and encrypted session bridge',async()=>{
 const activity=await readFile(new URL('../android/control/src/main/java/iq/akkad/control/ControlActivity.java',import.meta.url),'utf8');
 const manifest=await readFile(new URL('../android/control/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 const admin=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
 assert.match(activity,/AndroidKeyStore/);
 assert.match(activity,/AES\/GCM\/NoPadding/);
 assert.match(activity,/AkkadAdminSession/);
 assert.match(activity,/onReceivedError/);
 assert.match(activity,/onReceivedSslError/);
 assert.match(manifest,/screenOrientation="portrait"/);
 assert.match(admin,/admin-retry-connection/);
});
