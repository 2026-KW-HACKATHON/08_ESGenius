import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { constructionPlan, constructionRoutes, constructionRevision } from '../src/construction-routing.js';
import { readNotices } from '../src/construction-notices.js';
import type { Dataset, RouteRequest } from '../src/schemas.js';
const data=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
const now=new Date('2026-10-07T00:00:00+09:00');
const catalog={...readNotices(now),stale:false};
const request:RouteRequest={originNodeId:'436855625',destinationNodeId:'3834716379',profile:'WALK',avoidStairs:true,preference:'COMFORT',maxDetourRatio:1.5};
test('real Wolgye route detours around located public construction; all returned routes exclude mapped edges',()=>{
  const p=constructionPlan(data,[],now,catalog),r=constructionRoutes(data,[],request,'v1',now,catalog);
  assert.equal(r.status,'OK');assert.equal(r.constructionAvoidance.avoided.length,1);
  const excluded=new Set(p.entries.flatMap(n=>n.edgeIds));
  for(const route of r.routes){assert.ok(route.edgeIds.every(id=>!excluded.has(id)));assert.ok(route.constructionDetour.extraDistanceM>0);assert.ok(route.labels.includes('CONSTRUCTION_AVOID'));}
  assert.equal(r.routes[0]!.distanceM,159);assert.equal(r.routes[0]!.constructionDetour.extraDistanceM,73);
  assert.equal(r.graphVersion,constructionRevision('v1',p));
});
test('no bypass never falls back into a construction edge; an already arrived request stays arrived',()=>{
  const r=constructionRoutes(data,[],{...request,originNodeId:'3836471861',destinationNodeId:'1795189932'},'v1',now,catalog);
  assert.equal(r.status,'NO_MATCHING_ROUTE');assert.deepEqual(r.routes,[]);assert.match(r.notice??'',/공사 구간으로 자동 안내하지/);
  assert.equal(constructionRoutes(data,[],{...request,destinationNodeId:request.originNodeId},'v1',now,catalog).status,'ALREADY_ARRIVED');
});
test('stale, future, expired, unlocated and outside-boundary notices do not invent exclusions; changes invalidate route version',()=>{
  const p=constructionPlan(data,[],now,catalog);
  const stale=constructionPlan(data,[],now,{...catalog,stale:true});assert.equal(stale.entries.length,0);
  assert.notEqual(constructionRevision('v1',p),constructionRevision('v1',stale));
  const future=constructionPlan(data,[],now,{...catalog,items:catalog.items.map(n=>({...n,period:'UPCOMING' as const}))});assert.equal(future.entries.length,0);
  const past=constructionPlan(data,[],now,{...catalog,items:catalog.items.map(n=>({...n,period:'PAST_PERIOD' as const}))});assert.equal(past.entries.length,0);
  assert.equal(p.entries.length,2);assert.ok(p.unmapped.length>0);
  assert.ok(p.entries.every(n=>n.basis==='ADDRESS_RADIUS_ESTIMATE'));
});

test('project representative coordinates do not become road closures',()=>{
  const located=catalog.items.find(n=>n.position&&n.routingEligible!==false&&n.period==='IN_PERIOD')!;
  const project={...located,id:'project-reference',routingEligible:false,locationKind:'PROJECT_POINT' as const};
  const p=constructionPlan(data,[],now,{...catalog,items:[project]});
  assert.deepEqual(p.entries,[]);assert.deepEqual(p.unmapped,['project-reference']);
});
