import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {buildApp} from '../src/app.js';
import {Store} from '../src/store.js';
import {demoDataset} from '../src/demo.js';
import {journeyRoutes} from '../src/journey.js';
import {constructionRoutes} from '../src/construction-routing.js';
import type {Config} from '../src/config.js';
import type {RouteRequest} from '../src/schemas.js';
const now=new Date('2026-10-08T12:00:00Z');
const config:Config={databasePath:':memory:',demoMode:true,production:false,host:'127.0.0.1',port:4104,jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[],devUserToken:'u'.repeat(40),devAdminToken:'a'.repeat(40)};
const user={authorization:'Bearer '+config.devUserToken},admin={authorization:'Bearer '+config.devAdminToken};
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jh6sAAAAASUVORK5CYII=';

test('browser preflights permit confirmation and saved-route mutations',async t=>{
  const store=new Store(':memory:');const app=await buildApp({...config,corsOrigins:['http://127.0.0.1:5174']},{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
  for(const method of ['PUT','DELETE','PATCH']){
    const response=await app.inject({method:'OPTIONS',url:'/api/v1/reports/example/confirmation',headers:{origin:'http://127.0.0.1:5174','access-control-request-method':method,'access-control-request-headers':'authorization'}});
    assert.equal(response.statusCode,204);assert.ok(String(response.headers['access-control-allow-methods']).split(',').map(v=>v.trim()).includes(method));assert.equal(response.headers['access-control-allow-origin'],'http://127.0.0.1:5174');
  }
});
test('new report categories, photo validation, summaries and private moderation queue',async t=>{
  const store=new Store(':memory:');store.importDataset(demoDataset(now));const app=await buildApp(config,{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
  const body={title:'사진이 있는 보도 제보',description:'메모리 데이터베이스에만 기록하는 화면 검증 제보입니다.',position:demoDataset(now).nodes[0]!.position,type:'ROAD_DAMAGE',photos:[pixel]};
  const create=(payload:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/v1/reports',headers:{...user,'idempotency-key':randomUUID()},payload});
  assert.equal((await create({...body,photos:['data:image/png;base64,PHNjcmlwdD4=']})).statusCode,400);
  assert.equal((await create({...body,photos:[pixel,pixel,pixel]})).statusCode,400);
  const created=await create(body);assert.equal(created.statusCode,201);const report=created.json().data;
  assert.deepEqual((await app.inject('/api/v1/reports/'+report.id)).json().data.photos,[pixel]);
  assert.equal((await create({...body,type:'DANGER',photos:[]})).statusCode,201);
  assert.deepEqual((await app.inject('/api/v1/reports/summary')).json().data,{verified:0,pending:2,total:2});
  const flag={method:'POST' as const,url:'/api/v1/reports/'+report.id+'/flags',payload:{reason:'검증용 신고'}};
  assert.equal((await app.inject(flag)).statusCode,401);
  assert.equal((await app.inject({...flag,headers:user})).statusCode,200);
  await app.inject({...flag,headers:user});assert.equal((await app.inject({url:'/api/v1/admin/report-flags',headers:admin})).json().data.length,1);
  assert.equal((await app.inject({url:'/api/v1/admin/report-flags',headers:user})).statusCode,403);
  assert.equal((await app.inject('/api/v1/reports/'+report.id)).json().data.status,'PENDING');
  await app.inject({method:'PATCH',url:'/api/v1/admin/reports/'+report.id,headers:admin,payload:{expectedVersion:1,status:'HIDDEN',reason:'검증용 숨김'}});
  assert.equal((await app.inject('/api/v1/reports/summary')).json().data.total,1);
  assert.equal((await app.inject({...flag,headers:user})).statusCode,404);
});
test('waypoints preserve leg geometry, summed time, unique facilities and saved conditions',async t=>{
  const data=demoDataset(now),via=data.edges.find(e=>e.id==='bright-1')!.to;
  const request:RouteRequest={originNodeId:'demo-start',destinationNodeId:'demo-end',viaNodeIds:[via],profile:'WALK',avoidStairs:false,preference:'NIGHT',maxDetourRatio:1.5};
  const result=journeyRoutes(data,[],request,'1',now);assert.equal(result.status,'OK');
  const first=constructionRoutes(data,[],{...request,viaNodeIds:[],destinationNodeId:via},'1',now);
  const second=constructionRoutes(data,[],{...request,viaNodeIds:[],originNodeId:via},'1',now);
  for(const route of result.routes){const label=route.labels[0];const a=first.routes.find(r=>r.labels.includes(label!))??first.routes[0]!;const b=second.routes.find(r=>r.labels.includes(label!))??second.routes[0]!;assert.equal(route.distanceM,a.distanceM+b.distanceM);assert.equal(route.estimatedDurationSec,a.estimatedDurationSec+b.estimatedDurationSec);assert.deepEqual(route.geometry.coordinates,[...a.geometry.coordinates,...b.geometry.coordinates.slice(1)]);assert.equal(route.facilities.ids.length,new Set(route.facilities.ids).size);}
  assert.throws(()=>journeyRoutes(data,[],{...request,viaNodeIds:['demo-start']},'1',now),/서로 다른/);
  const store=new Store(':memory:');store.importDataset(data);const app=await buildApp(config,{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
  const response=await app.inject({method:'POST',url:'/api/v1/routes/search',payload:request});assert.equal(response.statusCode,200);assert.ok(response.json().data.routes.length);
  const saved=await app.inject({method:'POST',url:'/api/v1/me/routes',headers:user,payload:{name:'경유지 포함 경로',search:request}});assert.equal(saved.statusCode,201);assert.deepEqual(saved.json().data.search.viaNodeIds,[via]);
  const invalid=await app.inject({method:'POST',url:'/api/v1/me/routes',headers:user,payload:{name:'잘못된 경유지',search:{...request,viaNodeIds:['missing-node']}}});assert.equal(invalid.statusCode,422);
});
