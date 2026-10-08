import { constructionRoutes } from './construction-routing.js';
import { ApiError } from './errors.js';
import { isFresh } from './routing.js';
import {lineDistance} from './geo.js';
import type { Construction, Dataset, RouteRequest } from './schemas.js';

export function journeyRoutes(data:Dataset, controls:Construction[], request:RouteRequest, revision:string, now:Date) {
  const points=[request.originNodeId,...(request.viaNodeIds??[]),request.destinationNodeId];
  if(!request.viaNodeIds?.length)return constructionRoutes(data,controls,request,revision,now);
  if(new Set(points).size!==points.length)throw new ApiError(400,'DUPLICATE_WAYPOINT','출발지, 경유지, 도착지는 서로 다른 장소를 선택해주세요.');
  const legs=points.slice(1).map((to,i)=>constructionRoutes(data,controls,{...request,viaNodeIds:[],originNodeId:points[i]!,destinationNodeId:to},revision,now));
  const failed=legs.find(l=>l.status!=='OK');
  if(failed)return {...failed,routes:[],notice:'경유지를 포함한 구간에 이용 가능한 길이 없습니다. 경유지나 이동 조건을 바꿔주세요.'};
  const unique=<T>(values:T[])=>[...new Set(values)];
  const routes=[...new Set(['FAST',request.preference])].map(label=>{
    const parts=legs.map(l=>(l.routes.find(r=>r.labels.includes(label))??l.routes[0])!);
    const sum=(fn:(r:typeof parts[number])=>number)=>parts.reduce((n,r)=>n+fn(r),0);
    const distanceM=sum(r=>r.distanceM),litM=sum(r=>r.lighting.litM),darkM=sum(r=>r.lighting.darkM);
    const ids=unique(parts.flatMap(r=>r.facilities.ids));
    const count=(type:string)=>ids.filter(id=>data.facilities.some(f=>f.id===id&&f.type===type)).length;
    const working=(type:string)=>ids.filter(id=>data.facilities.some(f=>f.id===id&&f.type===type&&f.status==='WORKING'&&isFresh(f.source,now))).length;
    const avoided=[...new Map(parts.flatMap(r=>r.constructionDetour.avoided).map(a=>[a.id,a])).values()];
    const registered=request.dataPolicy==='REFERENCE'&&request.preference==='NIGHT'?data.facilities.filter(f=>f.status!=='BROKEN'&&f.locationKind!=='ADDRESS'&&f.access!=='INDOOR'&&parts.some(r=>lineDistance(f.position,r.geometry.coordinates.map(p=>({lng:p[0]!,lat:p[1]!})))<=25)):[];
    return {...parts[0]!,labels:[label],edgeIds:parts.flatMap(r=>r.edgeIds),distanceM,estimatedDurationSec:sum(r=>r.estimatedDurationSec),
      detourRatio:Math.max(...parts.map(r=>r.detourRatio)),geometry:{type:'LineString' as const,coordinates:parts.flatMap((r,i)=>i?r.geometry.coordinates.slice(1):r.geometry.coordinates)},
      lighting:{litM,darkM,unknownM:sum(r=>r.lighting.unknownM),observedLitRatio:distanceM?litM/distanceM:0},
      facilities:{streetlights:count('STREETLIGHT'),cctv:count('CCTV'),emergencyBells:count('EMERGENCY_BELL'),ids},
      nightSafety:{narrowM:sum(r=>r.nightSafety.narrowM),widthUnknownM:sum(r=>r.nightSafety.widthUnknownM),workingStreetlights:working('STREETLIGHT'),workingBells:working('EMERGENCY_BELL')},
      quality:{dataPolicy:request.dataPolicy??'VERIFIED',slopeUnknownM:sum(r=>r.quality.slopeUnknownM),accessibilityUnknownM:sum(r=>r.quality.accessibilityUnknownM),registeredStreetlights:registered.filter(f=>f.type==='STREETLIGHT').length,registeredBells:registered.filter(f=>f.type==='EMERGENCY_BELL').length,registeredCctv:registered.filter(f=>f.type==='CCTV').length},
      segments:parts.flatMap(r=>r.segments),warnings:unique(parts.flatMap(r=>r.warnings)),
      constructionDetour:{avoided,extraDistanceM:sum(r=>r.constructionDetour.extraDistanceM),extraDurationSec:sum(r=>r.constructionDetour.extraDurationSec)}};
  });
  const avoided=[...new Map(legs.flatMap(l=>l.constructionAvoidance.avoided).map(a=>[a.id,a])).values()];
  const baselineDistanceM=legs.every(l=>l.constructionAvoidance.baselineDistanceM!==null)?legs.reduce((sum,l)=>sum+l.constructionAvoidance.baselineDistanceM!,0):null;
  return {...legs[0]!,routes,singleRouteReason:null,constructionAvoidance:{...legs[0]!.constructionAvoidance,avoided,baselineDistanceM}};
}
