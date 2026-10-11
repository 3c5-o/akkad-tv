import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requestMedia} from '../media-gateway.mjs';

const source={endpoint:'https://origin.akkad.example:443',kind:'xtream',allow_insecure_http:false};
const resolver=async()=>[{address:'1.1.1.1'}];
process.env.AKKAD_ALLOWED_SOURCE_HOSTS='origin.akkad.example';

test('IPTV video safely follows a 302 to public CDN and retains byte range',async()=>{
 const calls=[];
 const fetcher=async(url,options)=>{
  calls.push({url,headers:options.headers,redirect:options.redirect});
  if(calls.length===1)return new Response(null,{status:302,headers:{location:'https://cdn.akkad.example/video/stream.mp4'}});
  return new Response('media',{status:206,headers:{'content-type':'video/mp4','content-range':'bytes 0-4/20'}});
 };
 const result=await requestMedia('https://origin.akkad.example:443/movie/demo/123.mp4',source,{range:'bytes=0-4',fetcher,resolver});
 assert.equal(result.redirects,1);
 assert.equal(result.upstream,'https://cdn.akkad.example/video/stream.mp4');
 assert.equal(calls.length,2);
 assert.equal(calls[0].redirect,'manual');
 assert.equal(calls[1].headers.range,'bytes=0-4');
 await result.response.body?.cancel();
});
test('redirect to metadata/private IP is never fetched',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return new Response(null,{status:302,headers:{location:'http://169.254.169.254/latest/meta-data'}})};
 await assert.rejects(requestMedia('https://origin.akkad.example/movie/a/123.mp4',source,{fetcher,resolver}),/غير آمن|مسموح/);
 assert.equal(calls,1);
});
test('redirect cycles stop after five attempts',async()=>{
 let count=0;
 const fetcher=async()=>{count++;return new Response(null,{status:302,headers:{location:'/loop'}})};
 await assert.rejects(requestMedia('https://origin.akkad.example/movie/a/123.mp4',source,{fetcher,resolver}),/التحويلات/);
 assert.equal(count,6);
});
test('both portrait admin and landscape viewer ship with safe entry points',async()=>{
 const admin=await readFile(new URL('../public/admin.html',import.meta.url),'utf8');
 const tv=await readFile(new URL('../public/tv.html',import.meta.url),'utf8');
 const manifest=await readFile(new URL('../android/control/src/main/AndroidManifest.xml',import.meta.url),'utf8');
 const activity=await readFile(new URL('../android/control/src/main/java/iq/akkad/control/ControlActivity.java',import.meta.url),'utf8');
 assert.match(admin,/control-orbit\.css/);
 assert.match(admin,/source-playback-probe/);
 assert.match(tv,/mpegts\.min\.js/);
 assert.match(manifest,/screenOrientation="portrait"/);
 assert.match(activity,/FLAG_SECURE/);
});
