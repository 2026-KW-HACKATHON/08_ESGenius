import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseSheet} from '../src/seoul-sheet.js';
import {terrainFeatures,extraMapFeatures} from '../src/map-features.js';
import {Store} from '../src/store.js';
import {buildApp} from '../src/app.js';
import {computeRoutes} from '../src/routing.js';
import {demoDataset} from '../src/demo.js';
import {planRoute} from '../src/route-planner.js';
import type {Dataset} from '../src/schemas.js';
const data:Dataset=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8'));
const now=new Date('2026-10-08T09:00:00Z');

test('filming presets show a substantial real stair detour and registered night facilities',()=>{
 const base={origin:{lat:37.6179636,lng:127.0572659},destination:{lat:37.6148731,lng:127.0648373},profile:'WALK' as const,preference:'FAST' as const,avoidStairs:false,avoidSlopes:false,dataPolicy:'REFERENCE' as const,maxDetourRatio:1.5};
 const fast=planRoute(data,[],base,'test',now).routes[0]!;assert.equal(fast.distanceM,849);assert.equal(fast.segments.filter(s=>s.stairs).length,1);
 for(const profile of ['WALK','WHEELCHAIR'] as const){const r=planRoute(data,[],{...base,profile,preference:'COMFORT',avoidStairs:true,avoidSlopes:true},'test',now).routes[0]!;assert.equal(r.distanceM,1407);assert.ok(r.segments.every(s=>!s.stairs));assert.equal(r.quality.slopeUnknownM,1407);if(profile==='WHEELCHAIR')assert.equal(r.quality.accessibilityUnknownM,1407);}
 const night=planRoute(data,[],{...base,preference:'NIGHT',origin:{lat:37.614565,lng:127.0637752},destination:{lat:37.6223297,lng:127.0614422}},'test',now).routes[0]!;assert.equal(night.distanceM,1159);assert.equal(night.quality.registeredStreetlights,9);assert.equal(night.quality.registeredCctv,18);assert.equal(night.lighting.litM,0);
});

test('public sheet parser preserves literal control characters and rejects executable input',()=>{
 const r=parseSheet('{result:"ok",list:[{ADDR:"주소\n둘째 줄, 값: x",},],}');assert.equal(r.list[0]!.ADDR,'주소\n둘째 줄, 값: x');
 assert.throws(()=>parseSheet('{result:"ok",list:(()=>[])()}'));assert.throws(()=>parseSheet('{result:"error",list:[]}'));
});
test('terrain markers cover every registered stair edge without inventing unknown gradients',()=>{
 const terrain=terrainFeatures(data);assert.equal(terrain.length,11);assert.ok(terrain.every(i=>i.kind==='STAIRS'));
 assert.deepEqual(new Set(terrain.flatMap(i=>i.segments.map(s=>s.edgeId))),new Set(data.edges.filter(e=>e.stairs).map(e=>e.id)));
 const extra=extraMapFeatures(data);assert.deepEqual(extra.map(i=>i.kind),['SLOPE','ELEVATOR']);assert.equal(extraMapFeatures({...data,id:'other'}).length,0);
});
test('map pagination includes the terrain tail after 500 facilities and type filters stay complete',async t=>{
 const store=new Store(':memory:');store.importDataset(data);const app=await buildApp({databasePath:':memory:',production:false,demoMode:false,port:4104,host:'127.0.0.1',jwtAudience:'authenticated',adminSubjects:[],corsOrigins:[]},{store,now:()=>now});t.after(async()=>{await app.close();store.close();});
 const first=(await app.inject('/api/v1/map/items?limit=500')).json().data;assert.equal(first.items.length,500);assert.equal(first.nextOffset,500);
 const last=(await app.inject('/api/v1/map/items?offset=500&limit=500')).json().data;assert.equal(last.nextOffset,null);assert.equal(last.truncated,false);
 const all=[...first.items,...last.items];assert.equal(all.length,516);assert.equal(new Set(all.map(i=>i.id)).size,516);assert.equal(all.filter(i=>i.kind==='STAIRS').length,11);
 const bells=(await app.inject('/api/v1/map/items?types=EMERGENCY_BELL')).json().data;assert.equal(bells.items.length,6);assert.ok(bells.items.every((i:{access:string})=>i.access==='INDOOR'));
 assert.equal((await app.inject('/api/v1/map/items?offset=-1')).statusCode,400);
});
test('archived address points, indoor bells and CCTV do not bias outdoor night routing',()=>{
 const d=demoDataset(now),edge=d.edges[0]!,a=edge.geometry[0]!,b=edge.geometry.at(-1)!,middle={lat:(a.lat+b.lat)/2,lng:a.lng+.0004};
 d.edges=[{...edge,id:'first',lighting:'UNKNOWN',geometry:[a,{...middle,lng:a.lng-.0004},b],facilityIds:[]},{...edge,id:'other',lighting:'UNKNOWN',geometry:[a,middle,b],facilityIds:[]}];
 const request={originNodeId:edge.from,destinationNodeId:edge.to,profile:'WALK' as const,preference:'NIGHT' as const,avoidStairs:false,dataPolicy:'REFERENCE' as const,maxDetourRatio:1.5};
 d.facilities=[];const baseline=computeRoutes(d,[],request,'test',now).routes.find(r=>r.labels.includes('NIGHT'))!;
 const facility=demoDataset(now).facilities[0]!;
 for(const kind of ['address','indoor','cctv']){
   d.facilities=[{...facility,id:kind,position:middle,status:'UNKNOWN',type:kind==='cctv'?'CCTV':kind==='indoor'?'EMERGENCY_BELL':'STREETLIGHT',...(kind==='address'?{locationKind:'ADDRESS' as const}:kind==='indoor'?{access:'INDOOR' as const}:{})}];
   const r=computeRoutes(d,[],request,'test',now).routes.find(r=>r.labels.includes('NIGHT'))!;assert.deepEqual(r.edgeIds,baseline.edgeIds);assert.equal(r.quality.registeredStreetlights,0);assert.equal(r.quality.registeredBells,0);
 }
 // CCTV is still exposed as a count when on the actual chosen route.
 d.facilities[0]!.position=d.edges[0]!.geometry[1]!;const counted=computeRoutes(d,[],request,'test',now).routes.find(r=>r.labels.includes('NIGHT'))!;assert.equal(counted.quality.registeredCctv,1);assert.equal(counted.lighting.litM,0);
});
