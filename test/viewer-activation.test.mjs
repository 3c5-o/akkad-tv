import test from 'node:test';
import assert from 'node:assert/strict';
import {viewerRoutes} from '../viewer-service.mjs';
const viewer='8c02502e-9973-4d23-8aad-b65dece32018';
const admin=async()=>({token:'admin-jwt',role:'super_admin'});
function respond(_res,status,data){return {status,data}}
test('viewer directory is paginated and returns direct expiry status from a database RPC',async()=>{
 const calls=[];
 const out=await viewerRoutes({p:'/api/admin/viewers',req:{method:'GET',url:'/api/admin/viewers?search=akkad&offset=0&limit=50'},
  res:{},json:respond,auth:admin,apiRequest:async(path,opts)=>{
   calls.push([path,opts]);return [{user_id:viewer,username:'akkad_test',active:true,total_count:1,remaining_days:30}];
  }});
 assert.equal(out.status,200);assert.equal(out.data.items.length,1);
 assert.equal(out.data.total,1);
 assert.ok(calls[0][0].includes('akkad_admin_list_viewers'));
 assert.deepEqual(calls[0][1].body,{p_search:'akkad',p_offset:0,p_limit:50});
});
test('admin can grant 30-day subscription directly without generating activation code',async()=>{
 let request;
 const out=await viewerRoutes({p:'/api/admin/viewers/'+viewer+'/activate',
  req:{method:'POST'},res:{},json:respond,auth:admin,
  readBody:async()=>({days:30,plan_id:null}),
  apiRequest:async(path,opts)=>{request={path,opts};return [{subscription_id:'one',expires_at:'2026-11-09T10:00:00Z'}]}});
 assert.equal(out.status,200);assert.equal(out.data.subscription.subscription_id,'one');
 assert.match(request.path,/akkad_admin_activate_viewer$/);
 assert.deepEqual(request.opts.body,{p_user:viewer,p_days:30,p_plan:null});
});
test('invalid durations and non-administrator grants are blocked before database write',async()=>{
 let writes=0;
 const base={p:'/api/admin/viewers/'+viewer+'/activate',req:{method:'POST'},res:{},json:respond,
  readBody:async()=>({days:0}),auth:admin,apiRequest:async()=>{writes++;return []}};
 await assert.rejects(()=>viewerRoutes(base),/1095/);
 await assert.rejects(()=>viewerRoutes({...base,readBody:async()=>({days:30}),auth:async()=>({role:'admin',token:'admin'})}),/المدير الأساسي/);
 assert.equal(writes,0);
});
test('subscription pause calls protected update and does not delete the viewer',async()=>{
 let route,options;
 const out=await viewerRoutes({p:'/api/admin/viewers/'+viewer+'/subscription',req:{method:'PATCH'},res:{},json:respond,
  auth:admin,readBody:async()=>({status:'paused'}),
  apiRequest:async(p,o)=>{route=p;options=o;return [{id:'sub1'}]}});
 assert.equal(out.status,200);assert.equal(out.data.changed,1);
 assert.ok(route.includes('akkad_subscriptions?user_id=eq.'));
 assert.equal(options.body.status,'paused');
});
