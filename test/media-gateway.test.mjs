import test from 'node:test';
import assert from 'node:assert/strict';
import {issueTicket,verifyTicket,sealAsset,openAsset,xtreamMediaUrl,handleMedia} from '../media-gateway.mjs';

const secret='83'.repeat(32);
const source='5f8ddc67-c0ef-435a-bf6e-27ad1e71d64e';
const movie='9b3c7026-721f-490d-8e27-23fa2195b08b';
function withSecret(fn){
 const old=process.env.AKKAD_SOURCE_ENCRYPTION_KEY;
 process.env.AKKAD_SOURCE_ENCRYPTION_KEY=secret;
 try{return fn();}finally{if(old===undefined)delete process.env.AKKAD_SOURCE_ENCRYPTION_KEY;else process.env.AKKAD_SOURCE_ENCRYPTION_KEY=old;}
}
test('signed playback tickets are opaque, tamper-proof, one-hour and scoped to source/media',()=>withSecret(()=>{
 const ticket=issueTicket({source_id:source,media_id:movie,kind:'live',external_id:'1234'});
 const item=verifyTicket(ticket);
 assert.equal(item.s,source);assert.equal(item.m,movie);assert.equal(item.k,'live');assert.equal(item.x,'1234');
 const broken=ticket.slice(0,-1)+(ticket.endsWith('A')?'B':'A');
 assert.throws(()=>verifyTicket(broken));
 assert.throws(()=>issueTicket({source_id:source,media_id:movie,kind:'live',external_id:'../../../etc/passwd'}));
}));
test('HLS segment URL sealing does not reveal provider credentials',()=>withSecret(()=>{
 const link='http://example.com/live/user/secret/channel/playlist.m3u8?session=PRIVATE';
 const encoded=sealAsset(link);
 assert.equal(openAsset(encoded),link);
 assert.ok(!encoded.includes('secret'));
 assert.throws(()=>openAsset(encoded.slice(0,-2)+'ab'));
}));
test('Xtream playback URL is built on server only with correct live/movie/episode extensions',()=>{
 const provider={kind:'xtream',endpoint:'http://iptv.example.com:8080'};
 const credentials={username:'test_user',password:'private_pass'};
 const base={x:'847',s:source,m:movie};
 assert.equal(new URL(xtreamMediaUrl(provider,credentials,{...base,k:'live'})).pathname,'/live/test_user/private_pass/847.m3u8');
 assert.equal(new URL(xtreamMediaUrl(provider,credentials,{...base,k:'live'},'ts')).pathname,'/live/test_user/private_pass/847.ts');
 assert.equal(new URL(xtreamMediaUrl(provider,credentials,{...base,k:'movie'})).pathname,'/movie/test_user/private_pass/847.mp4');
 assert.equal(new URL(xtreamMediaUrl(provider,credentials,{...base,k:'episode',ext:'mkv'})).pathname,'/series/test_user/private_pass/847.mkv');
 assert.throws(()=>xtreamMediaUrl(provider,credentials,{...base,k:'episode',ext:'exe'}));
});
test('free playback requests reject invalid code scopes before provider credentials are read',async()=>{
 const role=process.env.SUPABASE_SERVICE_ROLE_KEY,old=process.env.AKKAD_SOURCE_ENCRYPTION_KEY;
 process.env.SUPABASE_SERVICE_ROLE_KEY='test-service-role';process.env.AKKAD_SOURCE_ENCRYPTION_KEY=secret;
 try{
  const result=await handleMedia({
   req:{method:'GET',headers:{}},res:{},p:'/api/free/A1/watch/'+movie,
   url:new URL('http://localhost/api/free/A1/watch/'+movie),
   auth:async()=>{throw Error('guest must not call auth')},
   json:(_r,status,payload)=>({status,payload}),
   apiRequest:async(path)=>{
    if(path.includes('/rpc/akkad_free_item'))return [];
    throw Error('source credentials must not be accessed');
   }
  }).then(()=>null).catch(e=>e);
  assert.equal(result.status,403);
 }finally{if(old===undefined)delete process.env.AKKAD_SOURCE_ENCRYPTION_KEY;else process.env.AKKAD_SOURCE_ENCRYPTION_KEY=old;
 if(role===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=role}
});
