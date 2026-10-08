import { test } from 'node:test';
import assert from 'node:assert/strict';
import { presentationRoute } from '../src/demo-route';

test('presentation mobility profiles avoid recorded stairs without inventing slope observations',()=>{
  const walk=presentationRoute('WALK',false,false);
  assert.ok(walk.segments?.some(s=>s.stairs));
  for(const profile of ['WHEELCHAIR','STROLLER'] as const){
    const route=presentationRoute(profile,false,false);
    assert.ok(route.segments?.every(s=>!s.stairs));
    assert.ok(route.distanceM>walk.distanceM);
    assert.deepEqual(route.geometry.coordinates[0],walk.geometry.coordinates[0]);
    assert.deepEqual(route.geometry.coordinates.at(-1),walk.geometry.coordinates.at(-1));
    assert.ok(route.segments?.every(s=>s.slopePercent===undefined));
  }
});
test('night presentation preserves real geometry and unknown lighting status',()=>{
  const night=presentationRoute('WHEELCHAIR',true,true);
  assert.ok(night.geometry.coordinates.length>20);
  assert.equal(night.lighting.unknownM,night.distanceM);
  assert.ok(night.segments?.every(s=>!s.stairs));
});

test('construction presentation detours outside the closed segment and keeps mobility conditions',()=>{
  const before=presentationRoute('WHEELCHAIR',true,false);
  const after=presentationRoute('WHEELCHAIR',true,false,true);
  assert.notDeepEqual(after.geometry,before.geometry);
  assert.ok(after.distanceM>before.distanceM);
  assert.equal(after.constructionDetour?.avoided.length,1);
  assert.ok(after.segments?.every(s=>!s.stairs));
  assert.ok(after.segments?.every(segment=>segment.edgeId!=='osm-37401414-1'));
});

import { readFileSync } from 'node:fs';
test('every filmed road segment is an existing OSM edge with exact source geometry',()=>{
 const graph=JSON.parse(readFileSync(new URL('../../backend/data/wolgye1.dataset.json',import.meta.url),'utf8'));
 for(const route of [presentationRoute('WALK',false,false),presentationRoute('WHEELCHAIR',true,false),presentationRoute('WALK',true,true),presentationRoute('WHEELCHAIR',true,false,true)]){
  for(const segment of route.segments??[]){const original=graph.edges.find((e:any)=>e.id===segment.edgeId);assert.ok(original);const geometry=original.geometry.map((p:any)=>[p.lng,p.lat]);assert.ok(JSON.stringify(segment.geometry)===JSON.stringify(geometry)||JSON.stringify(segment.geometry)===JSON.stringify([...geometry].reverse()));}
 }
});
