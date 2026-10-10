import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerEmail} from '../viewer-service.mjs';
import {tmdbLookup} from '../admin-extras.mjs';
import {enrichItem,startAutoImport} from '../auto-import.mjs';

test('viewer logins use stable opaque Supabase email derived from username',()=>{
 const secret='ff'.repeat(32);
 const a=viewerEmail('viewer_01',secret),b=viewerEmail('viewer_01',secret),c=viewerEmail('viewer_02',secret);
 assert.equal(a,b);assert.notEqual(a,c);assert.ok(a.endsWith('@users.akkad.invalid'));
 assert.ok(!a.includes('viewer_01'));
 assert.throws(()=>viewerEmail('bad username',secret));
 assert.throws(()=>viewerEmail('viewer_01','unsafe'));
});
test('TMDb requires exact type and returns safe metadata without exposing API secrets',async()=>{
 let calls=0;
 const key='a'.repeat(32);
 const fake=async u=>{
  calls++;assert.equal(u.hostname,'api.themoviedb.org');
  assert.equal(u.pathname,'/3/search/movie');
  assert.equal(u.searchParams.get('api_key'),key);
  return new Response(JSON.stringify({results:[
   {id:999,title:'Test (2026)',overview:'Movie',release_date:'2026-05-05',poster_path:'/poster.jpg'}
  ]}),{status:200});
 };
 const result=await tmdbLookup('Test','movie',key,fake);
 assert.equal(result[0].tmdb_id,999);assert.equal(result[0].poster_url,'https://image.tmdb.org/t/p/w500/poster.jpg');
 assert.equal(calls,1);
 await assert.rejects(()=>tmdbLookup('T','movie',key,fake));
});
test('automatic TMDb matching enriches exact titles only and avoids unrelated results',async()=>{
 const base={title:'Movie Sample (2026)',kind:'movie',release_year:2026,dedupe_key:'old',poster_url:null};
 const ok=await enrichItem(base,'key',async()=>[
  {tmdb_id:8,title:'Another Movie',release_year:2026},
  {tmdb_id:42,title:'Movie Sample',release_year:2026,description:'Synopsis',poster_url:'https://image.tmdb.org/t/p/w500/x.jpg'}
 ]);
 assert.equal(ok.tmdb_id,42);
 assert.notEqual(ok.dedupe_key,'old');
 const mismatch=await enrichItem(base,'key',async()=>[{tmdb_id:9,title:'Unrelated',release_year:2026}]);
 assert.equal(mismatch.dedupe_key,'old');
});
test('automatic import stays disabled without service role instead of faking synchronization',()=>{
 const old=process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 try{const scheduler=startAutoImport({url:'https://project.supabase.co'});assert.equal(scheduler.enabled,false)}
 finally{if(old!==undefined)process.env.SUPABASE_SERVICE_ROLE_KEY=old}
});
