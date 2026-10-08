import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planRoute,MAX_CONNECTION_M} from '../src/route-planner.js';
import {computeRoutes} from '../src/routing.js';
import {constructionPlan} from '../src/construction-routing.js';
import {demoDataset} from '../src/demo.js';
import {Store} from '../src/store.js';
import {buildApp} from '../src/app.js';
import type {Dataset,RoutePlan} from '../src/schemas.js';
const now=new Date('2026-10-08T08:00:00Z');
const data=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
const plan:RoutePlan={origin:{lng:127.058270608867,lat:37.6192404638865},destination:{lng:127.0644787466723,lat:37.61508638301968},profile:'WALK',preference:'FAST',avoidStairs:false,avoidSlopes:false,dataPolicy:'REFERENCE',maxDetourRatio:1.5};

test('Kwangwoon university to Seokgye park resolves connected road endpoints instead of the isolated nearest node',()=>{
  const old=computeRoutes(data,[],{...plan,originNodeId:'3836444857',destinationNodeId:'5177812415'},'test',now);
  assert.equal(old.status,'NO_MATCHING_ROUTE');
  const result=planRoute(data,[],plan,'test',now);assert.equal(result.status,'OK');assert.equal(result.routes[0]!.distanceM,796);
  assert.equal(result.connections[1]!.nodeId,'436854869');assert.ok(result.connections.every(c=>c.offsetM<=MAX_CONNECTION_M&&!c.connectorSurveyed));
  const coords=result.routes[0]!.geometry.coordinates;const start=result.connections[0]!.position,end=result.connections[1]!.position;
  assert.deepEqual(coords[0],[start.lng,start.lat]);assert.deepEqual(coords.at(-1),[end.lng,end.lat]);
  const blocked=new Set(constructionPlan(data,[],now).entries.flatMap(e=>e.edgeIds));assert.ok(result.routes.every(r=>r.edgeIds.every(id=>!blocked.has(id))));
});
test('comfort reference routes exclude stairs, expose missing slopes, and verified mobility still fails closed',()=>{
  const result=planRoute(data,[],{...plan,preference:'COMFORT',avoidStairs:true,avoidSlopes:true},'test',now);
  assert.equal(result.status,'OK');assert.ok(result.routes.every(r=>r.segments.every(s=>!s.stairs)));assert.ok(result.routes[0]!.quality.slopeUnknownM>0);
  const strict=planRoute(data,[],{...plan,profile:'WHEELCHAIR',avoidStairs:true,avoidSlopes:true,dataPolicy:'VERIFIED'},'test',now);assert.equal(strict.status,'NO_MATCHING_ROUTE');
  const reference=planRoute(data,[],{...plan,profile:'WHEELCHAIR',avoidStairs:true,avoidSlopes:true},'test',now);assert.equal(reference.status,'OK');assert.ok(reference.routes[0]!.quality.accessibilityUnknownM>0);
});
test('reference never overrides known steps, steep slopes or blocked wheelchair access',()=>{
  const d=demoDataset(now);for(const e of d.edges){e.wheelchair='UNKNOWN';delete e.slopePercent;}
  const request={originNodeId:'demo-start',destinationNodeId:'demo-end',profile:'WHEELCHAIR' as const,preference:'COMFORT' as const,avoidStairs:true,avoidSlopes:true,dataPolicy:'REFERENCE' as const,maxDetourRatio:1.5};
  assert.equal(computeRoutes(d,[],request,'test',now).status,'OK');
  for(const kind of ['stairs','slope','blocked']){const copy=structuredClone(d);for(const e of copy.edges){if(kind==='stairs')e.stairs=true;else if(kind==='slope')e.slopePercent=12;else e.wheelchair='BLOCKED';}assert.equal(computeRoutes(copy,[],request,'test',now).status,'NO_MATCHING_ROUTE');}
});
test('endpoint matching never reverses a one-way path or reconnects a fully closed graph',()=>{
  const d=demoDataset(now),edge=d.edges.find(e=>e.id==='stairs')!;d.edges=[{...edge,stairs:false,bidirectional:false}];d.nodes=d.nodes.filter(n=>n.id===edge.from||n.id===edge.to);
  const request={...plan,origin:d.nodes[1]!.position,destination:d.nodes[0]!.position};
  assert.equal(planRoute(d,[],request,'test',now).status,'NO_MATCHING_ROUTE');
  const closed={id:'closure',title:'Test',description:'Test only',position:d.nodes[0]!.position,edgeIds:[edge.id],impact:'BLOCK' as const,startsAt:now.toISOString(),source:edge.source,reason:'test',version:1,status:'ACTIVE' as const,createdAt:now.toISOString()};
  assert.equal(planRoute(d,[closed],{...request,origin:request.destination,destination:request.origin},'test',now).status,'NO_MATCHING_ROUTE');
});
test('night reference prefers registered light proximity without claiming working or observed illumination',()=>{
  const d=demoDataset(now),edge=d.edges[0]!;
  const a=edge.geometry[0]!,b=edge.geometry.at(-1)!;
  const middle={lat:(a.lat+b.lat)/2,lng:a.lng+.0004};
  d.edges=[{...edge,id:'unlit',lighting:'UNKNOWN',geometry:[a,{...middle,lng:a.lng-.0004},b],facilityIds:[]},{...edge,id:'lamp-side',lighting:'UNKNOWN',geometry:[a,middle,b],facilityIds:[]}];
  d.facilities=[{...d.facilities[0]!,id:'registered',status:'UNKNOWN',position:middle,type:'STREETLIGHT',source:{...d.facilities[0]!.source,recheckAt:'2020-01-01T00:00:00Z'}}];
  const result=computeRoutes(d,[],{originNodeId:edge.from,destinationNodeId:edge.to,profile:'WALK',preference:'NIGHT',avoidStairs:false,dataPolicy:'REFERENCE',maxDetourRatio:1.5},'test',now);
  const route=result.routes.find(r=>r.labels.includes('NIGHT'))!;assert.deepEqual(route.edgeIds,['lamp-side']);assert.equal(route.lighting.litM,0);assert.equal(route.nightSafety.workingStreetlights,0);assert.equal(route.quality.registeredStreetlights,1);
});
test('position planning API exposes connections, FAST mode and ordered via stops; rejects out-of-coverage points',async t=>{
  const store=new Store(':memory:');store.importDataset(data);const app=await buildApp({databasePath:':memory:',production:false,demoMode:false,port:4104,host:'127.0.0.1',jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[]},{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
  const response=await app.inject({method:'POST',url:'/api/v1/routes/plan',payload:plan});assert.equal(response.statusCode,200);const r=response.json().data;assert.equal(r.status,'OK');assert.equal(r.resolvedSearch.preference,'FAST');assert.equal(r.connections.length,2);assert.equal(r.routes.length,1);assert.equal(r.routes[0].quality.dataPolicy,'REFERENCE');
  const middleEdge=data.edges.find(e=>e.id===r.routes[0].segments[Math.floor(r.routes[0].segments.length/2)].edgeId)!;
  const via=data.nodes.find(n=>n.id===middleEdge.from)!.position;
  const withVia=await app.inject({method:'POST',url:'/api/v1/routes/plan',payload:{...plan,via:[via]}});assert.equal(withVia.statusCode,200);assert.equal(withVia.json().data.connections.length,3);assert.equal(withVia.json().data.resolvedSearch.viaNodeIds.length,1);
  const outside=await app.inject({method:'POST',url:'/api/v1/routes/plan',payload:{...plan,destination:{lat:0,lng:0}}});assert.equal(outside.statusCode,422);
});
