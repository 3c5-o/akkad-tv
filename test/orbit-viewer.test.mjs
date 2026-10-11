import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const file=async p=>readFile(new URL('../'+p,import.meta.url),'utf8');

test('landscape viewer has VIP and source-scoped code logins',async()=>{
 const html=await file('public/tv.html');
 for(const id of ['tv-credentials-fields','tv-free-entry','tv-select-code','tv-select-vip','tv-login-form','tv-login-submit'])
  assert.ok(html.includes('id="'+id+'"'),'missing '+id);
 assert.match(html,/data-tv-section="favorites"/);
 assert.match(html,/data-tv-section="multiview"/);
 assert.match(html,/data-tv-section="sports"/);
 assert.match(html,/\/orbit-tv\.css/);
 assert.match(html,/\/orbit-tv\.js/);
 assert.doesNotMatch(html,/\/tv-gold\.css/);
});
test('extra viewer features do not require untrusted extra scripts',async()=>{
 const js=await file('public/orbit-tv.js');
 assert.match(js,/akkad_free_source/);
 assert.match(js,/instant\/vip/);
 assert.match(js,/instant\/free/);
 assert.match(js,/\bBearer\b/);
 assert.doesNotMatch(js,/eval\s*\(/);
});
test('native app is a fullscreen landscape TV-only build with secure HTTPS',async()=>{
 const manifest=await file('android/app/src/main/AndroidManifest.xml');
 const activity=await file('android/app/src/main/java/iq/akkad/tv/TvActivity.java');
 assert.match(manifest,/screenOrientation="landscape"/);
 assert.match(manifest,/LEANBACK_LAUNCHER/);
 assert.match(manifest,/usesCleartextTraffic="false"/);
 assert.match(activity,/FLAG_SECURE/);
 assert.match(activity,/startsWith\("\/api\/media\/"\)/);
 assert.match(activity,/MimeTypes\.APPLICATION_M3U8/);
 assert.match(activity,/ExoPlayer/);
});
