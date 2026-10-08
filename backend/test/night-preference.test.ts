import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDataset } from '../src/demo.js';
import { computeRoutes } from '../src/routing.js';
import type { Dataset } from '../src/schemas.js';
const now=new Date('2026-10-08T12:00:00Z');
function graph(){
  const d=demoDataset(now);const edge=d.edges[0]!;
  d.edges=[{...edge,id:'first',lighting:'LIT',passageWidthM:3,facilityIds:[]},{...edge,id:'second',lighting:'LIT',passageWidthM:3,facilityIds:[]}];
  return d;
}
function route(d:Dataset){return computeRoutes(d,[],{originNodeId:d.edges[0]!.from,destinationNodeId:d.edges[0]!.to,profile:'WALK',avoidStairs:false,preference:'NIGHT',maxDetourRatio:1.5},'test',now).routes.find(r=>r.labels.includes('NIGHT'))!;}
test('night prefers a wider lit passage over a narrow lit alley',()=>{
  const d=graph();d.edges[0]!.passageWidthM=1;
  const r=route(d);assert.deepEqual(r.edgeIds,['second']);assert.equal(r.nightSafety.narrowM,0);
});
test('working linked lamps and emergency bells influence night routes, broken or stale ones do not',()=>{
  for(const type of ['STREETLIGHT','EMERGENCY_BELL'] as const){
    const d=graph();d.facilities=[{...d.facilities[0]!,id:'facility',type,status:'WORKING'}];d.edges[1]!.facilityIds=['facility'];
    assert.deepEqual(route(d).edgeIds,['second']);
    d.facilities[0]!.status='BROKEN';assert.deepEqual(route(d).edgeIds,['first']);
    d.facilities[0]!.status='WORKING';d.facilities[0]!.source={...d.facilities[0]!.source,recheckAt:'2020-01-01T00:00:00Z'};
    assert.deepEqual(route(d).edgeIds,['first']);
  }
});
test('unknown width is not presented as a confirmed wide passage',()=>{
  const d=graph();delete d.edges[0]!.passageWidthM;delete d.edges[1]!.passageWidthM;
  const r=route(d);assert.equal(r.nightSafety.widthUnknownM,r.distanceM);
});
