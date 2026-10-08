import {test} from 'node:test';
import assert from 'node:assert/strict';
import {clusterItems,visibleItems,markerStyle,kindCount} from '../src/map-items';
import {showcases,showcaseOptions} from '../src/showcase';
import {routeConditions} from '../src/route-conditions';
import type {MapItem} from '../src/types';

test('construction notices share their filter, every clustered facility remains reachable',()=>{
 const items:MapItem[]=['CCTV','STREETLIGHT','CONSTRUCTION_NOTICE','STAIRS','EMERGENCY_BELL'].map((kind,i)=>({id:String(i),kind,position:{lat:37.62,lng:127.06}}));
 assert.deepEqual(visibleItems(items,new Set(['CONSTRUCTION'])).map(i=>i.id),['2']);
 const clusters=clusterItems(items,()=>({x:10,y:10}));assert.equal(clusters.length,1);assert.equal(clusters[0]!.kind,'CONSTRUCTION_NOTICE');assert.equal(clusters[0]!.members?.length,5);assert.equal(new Set(clusters[0]!.members?.map(i=>i.id)).size,5);
 assert.match(markerStyle('CCTV').icon,/imgIcon6/);assert.match(markerStyle('STREETLIGHT').icon,/imgIcon5/);
 assert.equal(kindCount([{...items[1]!,locationKind:'ADDRESS'},items[1]!],'STREETLIGHT'),'1위치 · 1주소');
});
test('showcase presets use real coordinates and explicitly request reference accessibility routes',()=>{
 assert.equal(new Set(showcases.map(s=>s.id)).size,showcases.length);for(const preset of showcases){assert.notDeepEqual(preset.origin.position,preset.destination.position);const conditions=routeConditions(showcaseOptions(preset.id));assert.equal(conditions.dataPolicy,'REFERENCE');if(preset.id==='comfort'||preset.id==='wheelchair'){assert.equal(conditions.avoidStairs,true);assert.equal(conditions.avoidSlopes,true);}else assert.equal(conditions.preference,preset.id==='night'?'NIGHT':'FAST');}
 assert.equal(showcaseOptions('wheelchair').profile,'WHEELCHAIR');
});
