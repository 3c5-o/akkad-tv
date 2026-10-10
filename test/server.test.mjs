import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';

test('local health and portrait/landscape routes', async () => {
  const port=39571;
  const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
  try {
    let health;
    for(let i=0;i<30;i++){
      try {health=await fetch('http://127.0.0.1:'+port+'/health');break;}catch {await new Promise(r=>setTimeout(r,100));}
    }
    assert.equal(health.status,200);
    assert.equal((await health.json()).service,'AKKAD CORE');
    const tv=await fetch('http://127.0.0.1:'+port+'/tv');
    assert.equal(tv.status,200);
    assert.match(await tv.text(),/أكّد/);
    const admin=await fetch('http://127.0.0.1:'+port+'/admin');
    assert.equal(admin.status,200);
    assert.match(await admin.text(),/الإدارة/);
    const unknown=await fetch('http://127.0.0.1:'+port+'/api/unknown');
    assert.equal(unknown.status,404);
    const protectedCheck=await fetch('http://127.0.0.1:'+port+'/api/admin/sources/22c1c6b4-c44e-4cd7-9fac-eb2dfc29d00f/check',{method:'POST'});
    assert.equal(protectedCheck.status,401);
    const protectedSync=await fetch('http://127.0.0.1:'+port+'/api/admin/sources/22c1c6b4-c44e-4cd7-9fac-eb2dfc29d00f/sync',{method:'POST'});
    assert.equal(protectedSync.status,401);
    const preflight=await fetch('http://127.0.0.1:'+port+'/api/admin/sources/preflight',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(preflight.status,401);
    const verified=await fetch('http://127.0.0.1:'+port+'/api/admin/sources/verified-create',{method:'POST',headers:{'content-type':'application/json'},body:'{}'});
    assert.equal(verified.status,401);
    assert.match(await adminClone(port),/source-preflight/);
    const controlStyle=await fetch('http://127.0.0.1:'+port+'/control.css');
    const controlScript=await fetch('http://127.0.0.1:'+port+'/control.js');
    assert.equal(controlStyle.status,200);
    assert.equal(controlScript.status,200);
    assert.match(await controlScript.text(),/source-create-form/);
    const unauthorized=await fetch('http://127.0.0.1:'+port+'/api/admin/extra/tmdb');
    assert.equal(unauthorized.status,401);
    const unauthorizedViewer=await fetch('http://127.0.0.1:'+port+'/api/admin/viewers');
    assert.equal(unauthorizedViewer.status,401);
  } finally {child.kill();}
});

async function adminClone(port){
 const r=await fetch('http://127.0.0.1:'+port+'/admin');
 return r.text();
}
