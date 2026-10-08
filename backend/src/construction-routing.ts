import { createHash } from 'node:crypto';
import { lineDistance, insideDataset } from './geo.js';
import { activeConstructions, computeRoutes } from './routing.js';
import { readNotices } from './construction-notices.js';
import type { Construction, Dataset, RouteRequest } from './schemas.js';

// Product avoidance policy, not a claim about the physical work boundary.
export const CONSTRUCTION_RADIUS_M=25;
export function constructionPlan(data:Dataset,controls:Construction[],now:Date,catalog=readNotices(now)){
  const entries=activeConstructions(controls,now).map(c=>({id:c.id,title:c.title,edgeIds:c.edgeIds,basis:'REGISTERED' as string}));
  const current=catalog.items.filter(n=>n.period==='IN_PERIOD');
  const unmapped:string[]=[];
  if(!data.isDemo)for(const n of current){
    if(catalog.stale||n.routingEligible===false||!n.position||!insideDataset(n.position,data)){unmapped.push(n.id);continue;}
    const edgeIds=data.edges.filter(e=>lineDistance(n.position!,e.geometry)<=CONSTRUCTION_RADIUS_M).map(e=>e.id);
    if(!edgeIds.length){unmapped.push(n.id);continue;}
    entries.push({id:n.id,title:n.title,edgeIds,basis:'ADDRESS_RADIUS_ESTIMATE'});
  }
  return {entries,unmapped,stale:!catalog.available||catalog.stale,radiusM:CONSTRUCTION_RADIUS_M};
}
export function constructionRevision(revision:string,plan:ReturnType<typeof constructionPlan>){
  return revision+'-place-routing-v3-construction-'+createHash('sha256').update(JSON.stringify(plan)).digest('hex').slice(0,12);
}
export function constructionRoutes(data:Dataset,controls:Construction[],request:RouteRequest,revision:string,now:Date,catalog=readNotices(now)){
  const plan=constructionPlan(data,controls,now,catalog),version=constructionRevision(revision,plan);
  // Comparison only: this potentially affected path is never returned for guidance.
  const baseline=computeRoutes(data,[],request,version,now);
  const avoidedEdges=new Set(plan.entries.flatMap(n=>n.edgeIds));
  const result=computeRoutes(data,controls,request,version,now,avoidedEdges);
  const reference=baseline.routes[0];
  const avoided=plan.entries.filter(n=>n.edgeIds.some(id=>reference?.edgeIds.includes(id))).map(({id,title,basis})=>({id,title,basis}));
  const notice=plan.stale?'공사 공개자료가 없거나 오래되어 주소 기반 자동 회피를 적용하지 못했습니다.':plan.unmapped.length?`현재 공개 공사 ${plan.unmapped.length}건은 위치·보행망 연결 미확인 또는 조사 범위 밖이라 자동 회피에 반영하지 못했습니다.`:'';
  return {...result,rulesVersion:'place-routing-v3',
    ...(result.status==='NO_MATCHING_ROUTE'&&avoided.length?{notice:'공사 회피 구간을 제외한 연결 경로가 없습니다. 공사 구간으로 자동 안내하지 않습니다. 출발·도착 지점을 변경해주세요.'}:{}),
    constructionAvoidance:{enabled:true,radiusM:plan.radiusM,mappedCount:plan.entries.length,unmappedCount:plan.unmapped.length,stale:plan.stale,notice,avoided,baselineDistanceM:reference?.distanceM??null},
    routes:result.routes.map(r=>({...r,labels:avoided.length?['CONSTRUCTION_AVOID',...r.labels]:r.labels,
      constructionDetour:{avoided,extraDistanceM:reference?Math.max(0,r.distanceM-reference.distanceM):0,extraDurationSec:reference?Math.max(0,r.estimatedDurationSec-reference.estimatedDurationSec):0},
      warnings:[...r.warnings,...(plan.entries.some(n=>n.basis==='ADDRESS_RADIUS_ESTIMATE')?[`공사 주소 기준점 ${plan.radiusM}m 이내 보행 구간을 예방적으로 피합니다. 실제 공사 범위·통제선은 미확인입니다.`]:[]),...(notice?[notice]:[])]}))};
}
