import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {requestMedia} from '../media-gateway.mjs';
import {verifySource} from '../source-manager.mjs';

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
 await assert.rejects(requestMedia('https://origin.akkad.example/movie/a/123.mp4',source,{fetcher,resolver}),/تحويلات/);
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

test('Xtream validates HTTP URL that redirects to HTTPS on same allowed host',async()=>{
 const calls=[];
 const fetcher=async u=>{
  calls.push(String(u));
  if(calls.length===1)return new Response(null,{status:301,headers:{location:'https://origin.akkad.example/player_api.php'}});
  return new Response(JSON.stringify({user_info:{auth:1,status:'Active',exp_date:1999999999,max_connections:1,active_cons:0}}),
   {status:200,headers:{'content-type':'application/json'}});
 };
 const result=await verifySource({kind:'xtream',endpoint:'http://origin.akkad.example:2082'},
   {username:'test',password:'example'},'origin.akkad.example',{allowHttp:true,lookup:resolver,fetch:fetcher});
 assert.equal(result.status,'Active');
 assert.equal(calls.length,2);
 assert.ok(calls[1].startsWith('https://origin.akkad.example/'));
});

test('Xtream authentication redirects to other host are blocked to avoid credential disclosure',async()=>{
 let calls=0;
 const fetcher=async()=>{calls++;return new Response(null,{status:302,headers:{location:'https://untrusted.akkad.example/api?password=secret'}});};
 await assert.rejects(verifySource({kind:'xtream',endpoint:'https://origin.akkad.example'},
  {username:'a',password:'b'},'origin.akkad.example',{lookup:resolver,fetch:fetcher}),/المصدر غير مسموح/);
 assert.equal(calls,1);
});
