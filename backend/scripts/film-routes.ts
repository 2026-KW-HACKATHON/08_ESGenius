import { readFileSync, writeFileSync } from 'node:fs';
import { computeRoutes } from '../src/routing.js';
import { lineDistance } from '../src/geo.js';
import type { Dataset, RouteRequest } from '../src/schemas.js';
const data=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
const origin=data.nodes.find(n=>n.id==='13662053187')!;
const destination=data.nodes.find(n=>n.id==='414687714')!;
const request:RouteRequest={originNodeId:origin.id,destinationNodeId:destination.id,profile:'WALK',avoidStairs:false,preference:'COMFORT',maxDetourRatio:1.5};
const fast=computeRoutes(data,[],request,'film-road-v1').routes[0]!;
const accessible=computeRoutes(data,[],{...request,avoidStairs:true},'film-road-v1').routes[0]!;
// Replay a road closure on an existing edge; never invent a road or mark accessibility PASS.
let blocked=data.edges.find(e=>e.id===accessible.edgeIds[5])!;
let detour=accessible;
for(const id of accessible.edgeIds.slice(2,15)){
 const candidate=computeRoutes(data,[],{...request,avoidStairs:true},'film-road-v1',new Date(),new Set([id])).routes[0];
 if(candidate&&candidate.distanceM>accessible.distanceM+30&&candidate.distanceM<accessible.distanceM+500){blocked=data.edges.find(e=>e.id===id)!;detour=candidate;break;}
}
if(detour===accessible)throw new Error('No real road detour found');
const lamps=data.facilities.filter(f=>lineDistance(f.position,accessible.geometry.coordinates.map(([lng,lat])=>({lng:lng!,lat:lat!})))<80);
const night={...accessible,labels:['NIGHT'],facilities:{...accessible.facilities,streetlights:lamps.length},nightSafety:undefined};
const payload={origin:{...origin,name:'광운대역 인근 출발점'},destination,fast,accessible,night,
 detour:{...detour,constructionDetour:{avoided:[{id:'film-closure',title:'보행로 통제 상황 재현',basis:'REPLAY_ON_REAL_ROAD'}],extraDistanceM:detour.distanceM-accessible.distanceM,extraDurationSec:detour.distanceM-accessible.distanceM}},
 construction:{id:'film-closure',kind:'CONSTRUCTION',title:'보행로 통제 상황 재현',impact:'BLOCK',position:blocked.geometry[0],segments:[{edgeId:blocked.id,coordinates:blocked.geometry.map(p=>[p.lng,p.lat])}]},
 facilities:lamps.map(f=>({...f,kind:f.type})),
 provenance:{datasetId:data.id,geometry:'Every segment is copied from the existing OSM pedestrian graph.',accessibility:'Unknown slope, width and wheelchair passability are not certified.',construction:'Road closure is replayed for filming, not a current field report.'}};
writeFileSync('../mobile/src/film-road-data.json',JSON.stringify(payload));
console.log({fast:fast.distanceM,accessible:accessible.distanceM,detour:detour.distanceM,points:accessible.geometry.coordinates.length,lamps:lamps.length,blocked:blocked.id});
