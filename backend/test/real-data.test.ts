import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Dataset } from '../src/schemas.js';
import { validateDataset, Store } from '../src/store.js';
import { insideDataset } from '../src/geo.js';
import { computeRoutes } from '../src/routing.js';
const data=JSON.parse(readFileSync(new URL('../data/wolgye1.dataset.json',import.meta.url),'utf8')) as Dataset;
test('real Wolgye1 snapshot is connected source data, never fabricated field verification',()=>{
 validateDataset(data);assert.equal(data.isDemo,false);assert.equal(data.nodes.length,1783);assert.equal(data.edges.length,1886);assert.equal(data.facilities.length,503);
 assert.ok(data.nodes.every(n=>insideDataset(n.position,data)));
 assert.ok(data.edges.every(e=>e.source.type==='OPEN_MAP'&&e.lighting==='UNKNOWN'&&e.wheelchair==='UNKNOWN'));
 assert.ok(data.facilities.every(f=>f.status==='UNKNOWN'&&f.source.dateMeaning&&Date.parse(f.source.recheckAt)<Date.parse('2026-10-08T09:00:00Z')));
 assert.equal(data.facilities.filter(f=>f.type==='CCTV').length,190);
 assert.equal(data.facilities.filter(f=>f.locationKind==='ADDRESS'&&f.source.type==='PUBLIC_ARCHIVE').length,290);
 assert.ok(data.facilities.filter(f=>f.type==='EMERGENCY_BELL').every(f=>f.access==='INDOOR'));
});
test('administrative polygon rejects bbox-only locations and report insertion',()=>{
 const [x1,y1,x2,y2]=data.bbox;let outside:{lat:number;lng:number}|undefined;
 for(let i=1;i<20&&!outside;i++)for(let j=1;j<20;j++){const p={lng:x1+(x2-x1)*i/20,lat:y1+(y2-y1)*j/20};if(!insideDataset(p,data)){outside=p;break;}}
 assert.ok(outside);const store=new Store(':memory:');try{store.importDataset(data);assert.throws(()=>store.createReport({title:'경계 밖 위치',description:'행정동 경계 밖의 제보는 등록하지 않아야 합니다.',type:'OBSTACLE',position:outside!},'test-user','test-key',new Date().toISOString()),/지원 영역 밖/);}finally{store.close();}
});
test('real graph supports reference walking but does not invent accessible or lit routes',()=>{
 const e=data.edges[0]!;const request={originNodeId:e.from,destinationNodeId:e.to,profile:'WALK' as const,preference:'NIGHT' as const,avoidStairs:false,maxDetourRatio:1.5};
 const result=computeRoutes(data,[],request,'1');assert.equal(result.status,'OK');assert.equal(result.isDemo,false);assert.equal(result.routes[0]!.lighting.litM,0);
 for(const profile of ['WHEELCHAIR','STROLLER'] as const){
   const unavailable=computeRoutes(data,[],{...request,profile,avoidSlopes:true},'1');
   assert.equal(unavailable.status,'NO_MATCHING_ROUTE');
   assert.equal(unavailable.routes.length,0);
   assert.ok('notice' in unavailable);
   assert.match(unavailable.notice??'',new RegExp(`${profile==='WHEELCHAIR'?'휠체어':'유모차'} 통행 가능 여부가 확인된 구간이 없습니다`));
   assert.match(unavailable.notice??'',/유효한 경사 정보가 없어/);
 }
});
