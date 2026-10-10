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
  } finally {child.kill();}
});
