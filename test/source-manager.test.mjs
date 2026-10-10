import test from 'node:test';
import assert from 'node:assert/strict';
import {
  publicAddress,validateEndpoint,encrypt,decrypt,parseM3U,normalized,
  xtreamOverview,verifySource,collectSource
} from '../source-manager.mjs';

const sourceId='b06de482-5dd5-4539-b69f-e616bfeb2593';
const key='a5'.repeat(32);
const allowlist='iptv.example.com';
test('IPTV accounts are encrypted at rest using AES-GCM',()=>{
 const secret={username:'licensed-user',password:'licensed-pass'};
 const record=encrypt(secret,key);
 assert.equal(decrypt(record,key).password,'licensed-pass');
 assert.ok(!JSON.stringify(record).includes(secret.password));
 assert.throws(()=>decrypt(record,'b4'.repeat(32)));
});
test('private, loopback, metadata, file and HTTP URLs are not accepted',()=>{
 for(const value of ['http://iptv.example.com','https://127.0.0.1','https://localhost',
 'https://169.254.169.254','file:///etc/passwd','https://iptv.example.com@evil.example.com',
 'https://iptv.example.com?password=bad','https://evil.example.com']){
   assert.throws(()=>validateEndpoint(value,allowlist),value);
 }
 assert.equal(validateEndpoint('https://iptv.example.com:8443/path/',allowlist).hostname,'iptv.example.com');
 assert.equal(publicAddress('10.1.2.3'),false);
 assert.equal(publicAddress('192.168.1.1'),false);
 assert.equal(publicAddress('8.8.8.8'),true);
});
test('M3U sections are classified and raw stream access tokens are not imported',()=>{
 const text='#EXTM3U\n#EXTINF:-1 tvg-id="news1" group-title="أخبار" tvg-name="قناة أخبار",قناة أخبار\nhttps://iptv.example.com/live?token=PRIVATE123\n#EXTINF:-1 group-title="أفلام" tvg-name="فيلم جديد",فيلم جديد\nhttps://iptv.example.com/vod?token=SECRET123\n#EXTINF:-1 group-title="مسلسلات" tvg-name="مسلسل",مسلسل\nhttps://iptv.example.com/series?token=PASS123\n';
 const parsed=parseM3U(text,sourceId,'movie',10);
 assert.deepEqual(parsed.totals,{live:1,movie:1,series:1});
 assert.equal(parsed.items.length,1);
 assert.equal(parsed.items[0].title,'فيلم جديد');
 assert.ok(!JSON.stringify(parsed).includes('SECRET123'));
});
test('same licensed movie with exact year produces same deduplication key',()=>{
 const a=normalized({stream_id:'7',name:'Cinema (2026)'},'movie','أفلام',sourceId);
 const b=normalized({stream_id:'41',name:'Cinema (2026)'},'movie','أفلام','0b3d07c3-8d76-4b03-a80b-70076dfe8982');
 assert.equal(a.dedupe_key,b.dedupe_key);
 const c=normalized({stream_id:'41',name:'Cinema (2024)'},'movie','أفلام','0b3d07c3-8d76-4b03-a80b-70076dfe8982');
 assert.notEqual(a.dedupe_key,c.dedupe_key);
});
test('valid Xtream overview reads account status and connection limits',()=>{
 const data=xtreamOverview({user_info:{auth:1,status:'Active',exp_date:'1800000000',max_connections:'3',active_cons:'1'}});
 assert.equal(data.status,'Active');assert.equal(data.max_connections,3);assert.equal(data.active_connections,1);
 assert.throws(()=>xtreamOverview({user_info:{auth:0}}));
});
test('Xtream fetch can be checked safely using mocked network and DNS',async()=>{
 const source={id:sourceId,kind:'xtream',endpoint:'https://iptv.example.com:8443/'};
 const creds={username:'u',password:'p'};
 const fakeFetch=async url=>{
   const action=new URL(url).searchParams.get('action');
   const payload=action==='get_vod_categories'?[{category_id:'2',category_name:'أفلام حديثة'}]:
     action==='get_vod_streams'?[{stream_id:100,name:'Test Film (2025)',category_id:2}]:
     {user_info:{auth:1,status:'Active',max_connections:'2'}};
   return new Response(JSON.stringify(payload),{status:200,headers:{'content-type':'application/json'}});
 };
 const options={fetch:fakeFetch,lookup:async()=>[{address:'8.8.8.8',family:4}]};
 const status=await verifySource(source,creds,allowlist,options);
 assert.equal(status.status,'Active');
 const result=await collectSource(source,creds,'movie',10,allowlist,options);
 assert.equal(result.total,1);
 assert.equal(result.items[0].category,'أفلام حديثة');
 assert.equal(result.items[0].title,'Test Film (2025)');
 assert.ok(!JSON.stringify(result).includes('"password"'));
});


test('M3U batches advance through distinct entries instead of repeating the first group',()=>{
 const rows=['#EXTM3U'];
 for(let i=0;i<7;i++){
  rows.push('#EXTINF:-1 group-title="أفلام" tvg-name="فيلم '+i+'",فيلم '+i);
  rows.push('https://iptv.example.com/movie/'+i+'?access=hidden'+i);
 }
 const first=parseM3U(rows.join('\n'),sourceId,'movie',3,0);
 const second=parseM3U(rows.join('\n'),sourceId,'movie',3,3);
 const last=parseM3U(rows.join('\n'),sourceId,'movie',3,6);
 assert.equal(first.totals.movie,7);
 assert.deepEqual(first.items.map(x=>x.title),['فيلم 0','فيلم 1','فيلم 2']);
 assert.deepEqual(second.items.map(x=>x.title),['فيلم 3','فيلم 4','فيلم 5']);
 assert.deepEqual(last.items.map(x=>x.title),['فيلم 6']);
 assert.ok(!JSON.stringify(first).includes('access=hidden'));
});
test('Xtream metadata pagination works using source cursor',async()=>{
 const source={id:sourceId,kind:'xtream',endpoint:'https://iptv.example.com'};
 const options={lookup:async()=>[{address:'8.8.8.8'}],fetch:async u=>{
  const action=new URL(u).searchParams.get('action');
  const rows=action==='get_vod_categories'?[{category_id:1,category_name:'أفلام'}]:
    Array.from({length:6},(_,i)=>({stream_id:i+1,name:'Film '+i+' (2026)',category_id:1}));
  return new Response(JSON.stringify(rows),{status:200});
 },offset:3};
 const out=await collectSource(source,{username:'user',password:'private'},'movie',2,allowlist,options);
 assert.deepEqual(out.items.map(x=>x.title),['Film 3 (2026)','Film 4 (2026)']);
 assert.equal(out.total,6);
 assert.ok(!JSON.stringify(out).includes('private'));
});
test('Xtream expired accounts cannot be marked as healthy',()=>{
 assert.throws(()=>xtreamOverview({user_info:{auth:1,status:'Expired',exp_date:'1700000000'}}));
 assert.throws(()=>xtreamOverview({user_info:{auth:1,status:'Active',exp_date:'1700000000'}}));
});


test('HTTP Xtream hosts require explicit opt-in and exact host allowlisting',()=>{
 assert.throws(()=>validateEndpoint('http://iptv.example.com:8080','iptv.example.com'));
 assert.equal(validateEndpoint('http://iptv.example.com:8080','iptv.example.com',{allowHttp:true}).protocol,'http:');
 assert.equal(validateEndpoint('http://8.8.8.8:8080','8.8.8.8',{allowHttp:true}).hostname,'8.8.8.8');
 for(const unsafe of ['http://127.0.0.1:8080','http://10.0.0.2','http://192.168.1.9','http://169.254.169.254','http://localhost','http://evil.example.com','ftp://iptv.example.com']){
   assert.throws(()=>validateEndpoint(unsafe,'iptv.example.com,127.0.0.1,10.0.0.2,192.168.1.9,169.254.169.254,localhost',{allowHttp:true}),unsafe);
 }
 assert.throws(()=>validateEndpoint('http://iptv.example.com/get.php?username=test','iptv.example.com',{allowHttp:true}));
 assert.throws(()=>validateEndpoint('http://iptv.example.com@evil.example.com','evil.example.com',{allowHttp:true}));
});
test('HTTP Xtream check and sync only work with transport opt-in and public DNS',async()=>{
 const source={id:sourceId,kind:'xtream',endpoint:'http://iptv.example.com:8080'};
 let fetched=0;
 const options={allowHttp:true,lookup:async()=>[{address:'8.8.8.8'}],fetch:async u=>{
   fetched++;
   assert.equal(new URL(u).protocol,'http:');
   const kind=new URL(u).searchParams.get('action');
   const data=kind==='get_vod_categories'?[{category_id:9,category_name:'مرخص'}]:
     kind==='get_vod_streams'?[{stream_id:1,name:'فيلم تجريبي (2026)',category_id:9}]:
     {user_info:{auth:1,status:'Active',max_connections:'2',active_cons:'0'}};
   return new Response(JSON.stringify(data),{status:200});
 }};
 await assert.rejects(()=>verifySource(source,{username:'test',password:'secret'},'iptv.example.com',{...options,allowHttp:false}));
 assert.equal(fetched,0);
 const overview=await verifySource(source,{username:'test',password:'secret'},'iptv.example.com',options);
 assert.equal(overview.max_connections,2);
 const items=await collectSource(source,{username:'test',password:'secret'},'movie',10,'iptv.example.com',options);
 assert.equal(items.items[0].category,'مرخص');
 assert.equal(items.total,1);
 assert.equal(fetched,3);
});
test('HTTP M3U index uses approved same-host public endpoint',async()=>{
 const source={id:sourceId,kind:'m3u',endpoint:'http://iptv.example.com:8080'};
 const credentials={playlist_url:'http://iptv.example.com:8080/get.php?token=secret'};
 const fake={allowHttp:true,lookup:async()=>[{address:'8.8.8.8'}],fetch:async u=>{
   assert.equal(new URL(u).protocol,'http:');
   return new Response('#EXTM3U\n#EXTINF:-1 group-title="أفلام" tvg-name="فيلم",فيلم\nhttp://iptv.example.com:8080/vod?id=1&token=secret\n',{status:200});
 }};
 const meta=await verifySource(source,credentials,'iptv.example.com',fake);
 assert.equal(meta.status,'Active');
 const data=await collectSource(source,credentials,'movie',10,'iptv.example.com',fake);
 assert.equal(data.items.length,1);
 assert.ok(!JSON.stringify(data).includes('token=secret'));
});
