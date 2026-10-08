import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/app.js';
import { Store, validateDataset } from '../src/store.js';
import { demoDataset } from '../src/demo.js';
import { computeRoutes } from '../src/routing.js';
import { checkNight } from '../src/night.js';
import { validateConfig, type Config } from '../src/config.js';
import { searchKakao } from '../src/kakao.js';
import type { Construction, ConstructionInput, RouteRequest } from '../src/schemas.js';

const now=new Date('2026-10-05T12:00:00Z');
const config:Config={databasePath:':memory:',demoMode:true,production:false,host:'127.0.0.1',port:4100,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[],devUserToken:'u'.repeat(40),devAdminToken:'a'.repeat(40)};
const route:RouteRequest={originNodeId:'demo-start',destinationNodeId:'demo-end',profile:'WHEELCHAIR',avoidStairs:true,preference:'NIGHT',maxDetourRatio:1.5};
const auth={authorization:'Bearer '+config.devUserToken};
const admin={authorization:'Bearer '+config.devAdminToken};
function closure(edges=['dark-1']):ConstructionInput {
  return {title:'시연 공사',description:'가상 공사 구간 통제',position:demoDataset(now).nodes[0]!.position,edgeIds:edges,impact:'BLOCK',startsAt:'2026-10-01T00:00:00Z',expectedEndAt:'2026-10-02T00:00:00Z',source:demoDataset(now).edges[0]!.source,reason:'현장 검증을 가정한 테스트'};
}
async function fixture(t:any){const app=await buildApp(config,{now:()=>now});t.after(()=>app.close());return app;}

test('night route differs from fast path and obeys detour ratio',()=>{
  const result=computeRoutes(demoDataset(now),[],route,'1',now);
  assert.equal(result.status,'OK');assert.equal(result.routes.length,2);
  const fast=result.routes[0]!,night=result.routes[1]!;
  assert.deepEqual(fast.edgeIds,['dark-1','dark-2']);assert.deepEqual(night.edgeIds,['bright-1','bright-2','bright-3']);
  assert.ok(night.detourRatio<=1.5);assert.equal(night.lighting.observedLitRatio,1);assert.equal(night.facilities.streetlights,2);
  assert.equal(night.facilities.cctv,1);assert.equal(night.geometry.coordinates[0]![0],127.061);
});
test('tight detour limit returns one deduplicated path',()=>{
  const result=computeRoutes(demoDataset(now),[],{...route,maxDetourRatio:1},'1',now);
  assert.equal(result.routes.length,1);assert.deepEqual(result.routes[0]!.labels,['FAST','NIGHT']);
});
test('confirmed expired construction remains blocked until explicitly resolved',()=>{
  const c:Construction={...closure(),id:'c1',version:1,status:'ACTIVE',createdAt:now.toISOString()};
  const result=computeRoutes(demoDataset(now),[c],route,'2',now);
  assert.equal(result.routes.length,1);assert.ok(!result.routes[0]!.edgeIds.includes('dark-1'));
  assert.equal(result.excludedEdges.construction,1);
  const cleared=computeRoutes(demoDataset(now),[{...c,status:'RESOLVED'}],route,'3',now);
  assert.equal(cleared.routes.length,2);
});
test('all accessible exits blocked yields no route; stairs are not a fallback',()=>{
  const c:Construction={...closure(['dark-1','bright-1']),id:'c1',version:1,status:'ACTIVE',createdAt:now.toISOString()};
  assert.equal(computeRoutes(demoDataset(now),[c],route,'1',now).status,'NO_MATCHING_ROUTE');
});
test('stale accessibility records excluded; stale illumination is unknown for WALK',()=>{
  const d=demoDataset(now);for(const e of d.edges)e.source.recheckAt='2026-10-04T00:00:00Z';
  assert.equal(computeRoutes(d,[],route,'1',now).status,'NO_MATCHING_ROUTE');
  const walk=computeRoutes(d,[],{...route,profile:'WALK'},'1',now);
  assert.ok(walk.routes[0]!.lighting.unknownM>0);assert.equal(walk.routes[0]!.lighting.litM,0);
});
test('one-way edges never traversed backwards',()=>{
  const d=demoDataset(now);for(const e of d.edges)e.bidirectional=false;
  assert.equal(computeRoutes(d,[],{...route,originNodeId:'demo-end',destinationNodeId:'demo-start'},'1',now).status,'NO_MATCHING_ROUTE');
});
test('same location and unsupported node are distinct results',()=>{
  assert.equal(computeRoutes(demoDataset(now),[],{...route,destinationNodeId:'demo-start'},'1',now).status,'ALREADY_ARRIVED');
  assert.throws(()=>computeRoutes(demoDataset(now),[],{...route,destinationNodeId:'missing'},'1',now),/조사된/);
});
test('dataset import rejects broken graph geometry and real/demo source mixing',()=>{
  const d=demoDataset(now);d.edges[0]!.geometry[0]={lat:0,lng:0};assert.throws(()=>validateDataset(d),/엣지/);
  const mixed=demoDataset(now);mixed.isDemo=false;assert.throws(()=>validateDataset(mixed),/혼합/);
});
test('facility counts unique across multiple edges, CCTV does not improve route cost',()=>{
  const d=demoDataset(now);d.edges.filter(e=>e.id.startsWith('dark')).forEach(e=>e.facilityIds=['demo-cctv']);
  const r=computeRoutes(d,[],route,'1',now);assert.deepEqual(r.routes[1]!.edgeIds,['bright-1','bright-2','bright-3']);
  assert.equal(r.routes[0]!.facilities.cctv,1);
});
test('night alerts pause for inaccurate, old and implausibly future GPS',()=>{
  const input={position:demoDataset(now).nodes[2]!.position,accuracyM:100,measuredAt:now.toISOString(),recentAlerts:[]};
  assert.equal(checkNight(demoDataset(now),input,now).state,'PAUSED');
  assert.equal(checkNight(demoDataset(now),{...input,accuracyM:10,measuredAt:'2026-10-05T11:00:00Z'},now).state,'PAUSED');
  assert.equal(checkNight(demoDataset(now),{...input,accuracyM:10,measuredAt:'2026-10-05T13:00:00Z'},now).state,'PAUSED');
});
test('night cooldown and line-based darkness warning',()=>{
  const d=demoDataset(now),input={position:d.nodes[2]!.position,accuracyM:10,measuredAt:now.toISOString(),recentAlerts:[]};
  const result=checkNight(d,input,now);assert.ok(result.alerts.some(x=>x.facilityId==='demo-lamp-1'));assert.ok(result.warnings!.length>0);
  const again=checkNight(d,{...input,recentAlerts:[{facilityId:'demo-lamp-1',alertedAt:now.toISOString()}]},now);
  assert.ok(!again.alerts.some(x=>x.facilityId==='demo-lamp-1'));
});
test('mobile API defaults, schema validation and OpenAPI available',async t=>{
  const app=await fixture(t);
  const r=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:{originNodeId:'demo-start',destinationNodeId:'demo-end'}});
  assert.equal(r.statusCode,200);assert.equal(r.json().meta.isDemo,true);
  const bad=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:{...route,maxDetourRatio:100}});assert.equal(bad.statusCode,400);
  const unknown=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:{...route,role:'admin'}});assert.equal(unknown.statusCode,400);
  const spec=await app.inject('/api/v1/openapi.json');assert.equal(spec.statusCode,200);assert.ok(spec.json().paths['/api/v1/night/check']);
});
test('admin authorization and JWT forgery rejected',async t=>{
  const app=await fixture(t),headers={...auth,'idempotency-key':randomUUID()};
  assert.equal((await app.inject({method:'POST',url:'/api/v1/admin/constructions',headers,payload:closure()})).statusCode,403);
  assert.equal((await app.inject({method:'GET',url:'/api/v1/admin/audit',headers:{authorization:'Bearer forged'}})).statusCode,401);
  assert.equal((await app.inject('/api/v1/admin/reports')).statusCode,401);
});
test('construction create replay, conflict, version guard and explicit release',async t=>{
  const app=await fixture(t),headers={...admin,'idempotency-key':randomUUID()};
  const send=(payload=closure())=>app.inject({method:'POST',url:'/api/v1/admin/constructions',headers,payload});
  const a=await send(),b=await send();assert.equal(a.statusCode,201);assert.equal(a.json().data.id,b.json().data.id);assert.equal(a.json().meta.graphVersion,b.json().meta.graphVersion);
  assert.equal((await send({...closure(),title:'다른 공사'})).statusCode,409);
  const id=a.json().data.id;
  const wrong=await app.inject({method:'POST',url:`/api/v1/admin/constructions/${id}/resolve`,headers:admin,payload:{expectedVersion:99,reason:'확인 후 해제'}});assert.equal(wrong.statusCode,409);
  const resolved=await app.inject({method:'POST',url:`/api/v1/admin/constructions/${id}/resolve`,headers:admin,payload:{expectedVersion:1,reason:'확인 후 해제'}});assert.equal(resolved.json().data.status,'RESOLVED');
  const audits=await app.inject({url:'/api/v1/admin/audit',headers:admin});assert.equal(audits.json().data.length,2);
});
test('future construction does not close today; date comparison respects offsets',async t=>{
  const app=await fixture(t);
  const r=await app.inject({method:'POST',url:'/api/v1/admin/constructions',headers:{...admin,'idempotency-key':randomUUID()},payload:{...closure(),startsAt:'2026-10-06T09:00:00+09:00',expectedEndAt:'2026-10-06T01:00:00Z'}});
  assert.equal(r.statusCode,201);
  const routes=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:route});assert.equal(routes.json().data.routes.length,2);
});
test('unverified report never changes route; confirmation idempotent and privacy preserved',async t=>{
  const app=await fixture(t),payload={title:'밤길 조명 확인 요청',description:'이 구간의 가로등이 꺼져 있는 것 같습니다.',position:{lat:37.622,lng:127.061},type:'POOR_LIGHTING'};
  const headers={...auth,'idempotency-key':randomUUID()};
  const created=await app.inject({method:'POST',url:'/api/v1/reports',headers,payload});assert.equal(created.statusCode,201);assert.equal(created.json().data.authorId,undefined);
  const id=created.json().data.id;
  const replay=await app.inject({method:'POST',url:'/api/v1/reports',headers,payload});assert.equal(replay.json().data.id,id);
  assert.equal((await app.inject({method:'PUT',url:`/api/v1/reports/${id}/confirmation`,headers:auth})).statusCode,403);
  for(let i=0;i<2;i++){const r=await app.inject({method:'PUT',url:`/api/v1/reports/${id}/confirmation`,headers:admin});assert.equal(r.json().data.confirmationCount,1);assert.equal(r.json().data.status,'PENDING');}
  for(let i=0;i<2;i++){const r=await app.inject({method:'DELETE',url:`/api/v1/reports/${id}/confirmation`,headers:admin});assert.equal(r.json().data.confirmationCount,0);}
  const r=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:route});assert.equal(r.json().data.routes.length,2);
});
test('hidden report removed from list, map and direct URL',async t=>{
  const app=await fixture(t);
  const r=await app.inject({method:'POST',url:'/api/v1/reports',headers:{...auth,'idempotency-key':randomUUID()},payload:{title:'제보 숨김 테스트',description:'숨겨야 하는 테스트 제보 본문입니다.',position:{lat:37.622,lng:127.061},type:'OBSTACLE'}});
  const id=r.json().data.id;
  assert.equal((await app.inject({method:'PATCH',url:`/api/v1/admin/reports/${id}`,headers:admin,payload:{expectedVersion:1,status:'HIDDEN',reason:'개인정보 포함 확인'}})).statusCode,200);
  assert.equal((await app.inject(`/api/v1/reports/${id}`)).statusCode,404);
  assert.equal((await app.inject('/api/v1/reports')).json().data.total,0);
  assert.ok(!(await app.inject('/api/v1/map/items')).json().data.items.some((x:any)=>x.id===id));
});
test('saved routes are scoped to user and never preserve obsolete navigation results',async t=>{
  const app=await fixture(t);
  const saved=await app.inject({method:'POST',url:'/api/v1/me/routes',headers:auth,payload:{name:'퇴근길',search:route}});
  assert.equal(saved.statusCode,201);assert.ok(!saved.json().data.geometry);
  await app.inject({method:'DELETE',url:`/api/v1/me/routes/${saved.json().data.id}`,headers:admin});
  assert.equal((await app.inject({url:'/api/v1/me/routes',headers:auth})).json().data.length,1);
  assert.equal((await app.inject({url:'/api/v1/me/routes',headers:admin})).json().data.length,0);
});

test('confirmed report history is private and removes withdrawn or hidden reports',async t=>{
  const app=await fixture(t);
  const r=await app.inject({method:'POST',url:'/api/v1/reports',headers:{...auth,'idempotency-key':randomUUID()},payload:{title:'현장 확인 목록 테스트',description:'주민이 직접 확인한 제보 테스트입니다.',position:{lat:37.622,lng:127.061},type:'OBSTACLE'}});
  const id=r.json().data.id;
  assert.equal((await app.inject('/api/v1/me/confirmations')).statusCode,401);
  await app.inject({method:'PUT',url:`/api/v1/reports/${id}/confirmation`,headers:admin});
  const rows=(await app.inject({url:'/api/v1/me/confirmations',headers:admin})).json().data;
  assert.equal(rows.length,1);assert.ok(!('authorId' in rows[0]));
  assert.equal((await app.inject({url:'/api/v1/me/confirmations',headers:auth})).json().data.length,0);
  await app.inject({method:'DELETE',url:`/api/v1/reports/${id}/confirmation`,headers:admin});
  assert.equal((await app.inject({url:'/api/v1/me/confirmations',headers:admin})).json().data.length,0);
  await app.inject({method:'PUT',url:`/api/v1/reports/${id}/confirmation`,headers:admin});
  await app.inject({method:'PATCH',url:`/api/v1/admin/reports/${id}`,headers:admin,payload:{expectedVersion:1,status:'HIDDEN',reason:'숨김 제보를 개인 확인 목록에서도 제외'}});
  assert.equal((await app.inject({url:'/api/v1/me/confirmations',headers:admin})).json().data.length,0);
});
test('nearby caps radius; invalid bbox and unsupported map filters rejected',async t=>{
  const app=await fixture(t);
  assert.equal((await app.inject('/api/v1/facilities/nearby?lat=37.622&lng=127.061&radiusM=501')).statusCode,400);
  assert.equal((await app.inject('/api/v1/map/items?bbox=128,38,127,37')).statusCode,400);
  assert.equal((await app.inject('/api/v1/map/items?types=SECRET')).statusCode,400);
  assert.ok((await app.inject('/api/v1/facilities/nearby?lat=37.622&lng=127.061')).json().data.every((x:any)=>x.distanceM<=500));
});
test('SQLite persists data across restart',()=>{
  const dir=mkdtempSync(join(tmpdir(),'wolgye-'));const path=join(dir,'test.sqlite');
  try{const s=new Store(path);s.importDataset(demoDataset(now));s.createConstruction(closure(),'admin',randomUUID(),now.toISOString());s.close();const restarted=new Store(path);assert.equal(restarted.constructions().length,1);assert.equal(restarted.revision(),'2');restarted.close();}finally{rmSync(dir,{recursive:true,force:true});}
});
test('production fails closed for demo data and static dev credentials',async()=>{
  assert.throws(()=>validateConfig({...config,production:true}),/Production/);
  assert.throws(()=>validateConfig({...config,production:true,demoMode:false,devUserToken:undefined,devAdminToken:undefined}),/JWT/);
  const s=new Store(':memory:');s.importDataset(demoDataset(now));
  await assert.rejects(()=>buildApp({...config,demoMode:false},{store:s}),/Demo database/);s.close();
});
test('no data mode returns explicit unavailable, never a made-up route',async t=>{
  const app=await buildApp({...config,demoMode:false});t.after(()=>app.close());
  const r=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:route});assert.equal(r.statusCode,503);assert.equal(r.json().error.code,'DATA_NOT_READY');
});
test('Kakao adapter sends server key and normalizes lon/lat, provider errors explicit',async()=>{
  const fake=(async(url:any,init:any)=>{assert.equal(new URL(url).searchParams.get('query'),'광운대학교');assert.equal(init.headers.Authorization,'KakaoAK test-key');return new Response(JSON.stringify({documents:[{id:'1',place_name:'테스트',x:'127.061',y:'37.623',road_address_name:'주소'}]}));}) as typeof fetch;
  const items=await searchKakao('광운대학교','test-key',fake);assert.equal(items[0]!.position.lng,127.061);
  await assert.rejects(()=>searchKakao('검색','key',(async()=>new Response('',{status:401})) as typeof fetch),/공급자/);
});
