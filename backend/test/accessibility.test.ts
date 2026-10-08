import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoDataset } from '../src/demo.js';
import { computeRoutes } from '../src/routing.js';
import type { RouteRequest } from '../src/schemas.js';
const now=new Date('2026-10-05T12:00:00Z');
const request:RouteRequest={originNodeId:'demo-start',destinationNodeId:'demo-end',profile:'WHEELCHAIR',avoidStairs:true,avoidSlopes:true,preference:'COMFORT',maxDetourRatio:1.5};
test('unknown slope cannot be offered when hill avoidance is enabled',()=>{
  assert.equal(computeRoutes(demoDataset(now),[],request,'1',now).status,'NO_MATCHING_ROUTE');
});
test('wheelchair and stroller avoid steep route even without explicit hill filter',()=>{
  const data=demoDataset(now);for(const e of data.edges)e.slopePercent=e.id.startsWith('dark')?12:3;
  for(const profile of ['WHEELCHAIR','STROLLER'] as const){
    const result=computeRoutes(data,[],{...request,profile,avoidSlopes:false},'1',now);
    assert.equal(result.status,'OK');assert.ok(result.routes.every(r=>r.edgeIds.every(id=>!id.startsWith('dark'))));
    assert.ok(result.routes[0]!.segments.every(s=>s.slopePercent===3&&!s.stairs));
  }
});
test('expired slope observations do not qualify for hill avoidance',()=>{
  const data=demoDataset(now);for(const e of data.edges){e.slopePercent=1;e.source.recheckAt='2020-01-01T00:00:00Z';}
  assert.equal(computeRoutes(data,[],{...request,profile:'WALK'},'1',now).status,'NO_MATCHING_ROUTE');
});
