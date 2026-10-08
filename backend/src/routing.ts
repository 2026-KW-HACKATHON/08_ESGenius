import { ApiError } from './errors.js';
import { lineLength, lineDistance } from './geo.js';
import type { Construction, Dataset, Edge, Position, RouteRequest } from './schemas.js';

export const isFresh = (source: Edge['source'], now: Date) => +new Date(source.observedAt) <= +now && +new Date(source.recheckAt) > +now;
export const activeConstructions = (all: Construction[], now: Date) => all.filter(c=>c.status==='ACTIVE' && +new Date(c.startsAt)<=+now);

// Reference mode retains unknown data as unknown; it never overrides known barriers.
export function edgeExclusion(e:Edge, request:Pick<RouteRequest,'profile'|'avoidStairs'|'avoidSlopes'|'dataPolicy'>,now:Date):'stairs'|'slope'|'accessibility'|null {
  if(e.stairs&&(request.avoidStairs||request.profile!=='WALK'))return 'stairs';
  if((request.avoidSlopes||request.profile!=='WALK')&&(e.slopePercent??0)>6)return 'slope';
  if(request.avoidSlopes&&request.dataPolicy!=='REFERENCE'&&(e.slopePercent===undefined||!isFresh(e.source,now)))return 'slope';
  const access=request.profile==='WHEELCHAIR'?e.wheelchair:e.stroller;
  if(request.profile!=='WALK'&&(access==='BLOCKED'||(request.dataPolicy!=='REFERENCE'&&(!isFresh(e.source,now)||access!=='PASS'))))return 'accessibility';
  return null;
}
type Arc = { edge: Edge; to: string; points: Position[]; length: number; cost: number; lighting: Edge['lighting']; cautions: string[] };
type Label = { node: string; length: number; cost: number; path: Arc[]; dead?: boolean };

class Heap {
  items: Label[]=[];
  push(x: Label) {
    this.items.push(x);let i=this.items.length-1;
    while(i>0){ const p=(i-1)>>1;if(this.items[p]!.cost<=x.cost)break;this.items[i]=this.items[p]!;i=p; }this.items[i]=x;
  }
  pop(): Label|undefined {
    const first=this.items[0],last=this.items.pop();if(!this.items.length)return first;
    let i=0;while(true){let c=i*2+1;if(c>=this.items.length)break;if(c+1<this.items.length&&this.items[c+1]!.cost<this.items[c]!.cost)c++;if(this.items[c]!.cost>=last!.cost)break;this.items[i]=this.items[c]!;i=c;}this.items[i]=last!;return first;
  }
}
// Pareto labels preserve a shorter but less well-lit prefix that may be needed
// to meet the detour budget. A single best-cost label per node would be wrong.
function search(adj: Map<string,Arc[]>, start: string, end: string, maxLength: number, usePreference: boolean): Label|undefined {
  const heap=new Heap(), labels=new Map<string,Label[]>();
  const initial={node:start,length:0,cost:0,path:[]};heap.push(initial);labels.set(start,[initial]);let expanded=0;
  while(heap.items.length){
    const curr=heap.pop()!;if(curr.dead)continue;
    if(curr.node===end)return curr;
    if(++expanded>100000)throw new ApiError(503,'ROUTING_CAPACITY','탐색량이 한도를 초과했습니다. 출발·도착 범위를 줄여주세요.');
    for(const arc of adj.get(curr.node)??[]){
      const next:Label={node:arc.to,length:curr.length+arc.length,cost:curr.cost+(usePreference?arc.cost:arc.length),path:[...curr.path,arc]};
      if(next.length>maxLength+1e-6)continue;
      const at=labels.get(next.node)??[];
      if(at.some(x=>!x.dead&&x.length<=next.length+1e-6&&x.cost<=next.cost+1e-6))continue;
      for(const x of at)if(next.length<=x.length+1e-6&&next.cost<=x.cost+1e-6)x.dead=true;
      labels.set(next.node,[...at.filter(x=>!x.dead),next]);heap.push(next);
    }
  }
}
export function computeRoutes(data: Dataset, constructions: Construction[], request: RouteRequest, revision: string, now = new Date(), automaticAvoidance = new Set<string>()) {
  const nodeIds=new Set(data.nodes.map(n=>n.id));
  if(!nodeIds.has(request.originNodeId)||!nodeIds.has(request.destinationNodeId))throw new ApiError(422,'UNSURVEYED_CONNECTION','조사된 출입 지점을 선택하세요.');
  const active=activeConstructions(constructions,now);
  const blocked=new Set(active.filter(c=>c.impact==='BLOCK').flatMap(c=>c.edgeIds));
  const adj=new Map<string,Arc[]>();
  const excluded={construction:0,automaticConstruction:0,stairs:0,accessibility:0,slope:0};
  for(const e of data.edges){
    if(blocked.has(e.id)){excluded.construction++;continue;}
    if(automaticAvoidance.has(e.id)){excluded.automaticConstruction++;continue;}
    const exclusion=edgeExclusion(e,request,now);if(exclusion){excluded[exclusion]++;continue;}
    const length=lineLength(e.geometry);if(length<0.01)continue;
    const lighting=isFresh(e.source,now)?e.lighting:'UNKNOWN';
    const cautions=active.filter(c=>c.impact==='CAUTION'&&c.edgeIds.includes(e.id)).map(c=>c.id);
    // CCTV counts do not determine safety or substitute for lighting observations.
    const width=isFresh(e.source,now)?e.passageWidthM:undefined;
    const working=data.facilities.filter(f=>e.facilityIds.includes(f.id)&&f.status==='WORKING'&&isFresh(f.source,now));
    // Width threshold and penalties are route preferences, not a safety certification.
    const nightCost=(lighting==='LIT'?1:lighting==='DARK'?4:3)+(width===undefined?1:width<2?4:0)
      +(working.some(f=>f.type==='STREETLIGHT')?0:.4)+(working.some(f=>f.type==='EMERGENCY_BELL')?0:.4);
    const nearbyRegistered=request.dataPolicy==='REFERENCE'&&request.preference==='NIGHT'?data.facilities.filter(f=>f.status!=='BROKEN'&&f.type!=='CCTV'&&f.access!=='INDOOR'&&f.locationKind!=='ADDRESS'&&lineDistance(f.position,e.geometry)<=25):[];
    const proximityDiscount=nearbyRegistered.some(f=>f.type==='STREETLIGHT')?.65:0;
    const bellDiscount=nearbyRegistered.some(f=>f.type==='EMERGENCY_BELL')?.25:0;
    const unknownSlope=e.slopePercent===undefined||!isFresh(e.source,now);
    const comfortCost=1+2*e.discomfort+(e.stairs?8:0)+(unknownSlope?1:Math.min(5,(e.slopePercent??0)/2));
    const multiplier=request.preference==='NIGHT'?Math.max(1,nightCost-proximityDiscount-bellDiscount):request.preference==='FAST'?1:comfortCost;
    const cost=length*(multiplier+(cautions.length?2:0));
    const add=(from:string,to:string,points:Position[])=>adj.set(from,[...(adj.get(from)??[]),{edge:e,to,points,length,cost,lighting,cautions}]);
    add(e.from,e.to,e.geometry);if(e.bidirectional)add(e.to,e.from,[...e.geometry].reverse());
  }
  const base={graphVersion:revision,rulesVersion:'place-routing-v3',isDemo:data.isDemo,datasetId:data.id,calculatedAt:now.toISOString(),excludedEdges:excluded};
  if(request.originNodeId===request.destinationNodeId)return {...base,status:'ALREADY_ARRIVED',routes:[],notice:'출발지와 도착지가 같습니다.'};
  const fast=search(adj,request.originNodeId,request.destinationNodeId,Infinity,false);
  if(!fast){
    const missing:string[]=[];
    if(request.profile!=='WALK'&&!data.edges.some(e=>!e.stairs&&isFresh(e.source,now)&&(request.profile==='WHEELCHAIR'?e.wheelchair:e.stroller)==='PASS'))
      missing.push(`${request.profile==='WHEELCHAIR'?'휠체어':'유모차'} 통행 가능 여부가 확인된 구간이 없습니다`);
    if(request.avoidSlopes&&!data.edges.some(e=>e.slopePercent!==undefined&&isFresh(e.source,now)))
      missing.push('유효한 경사 정보가 없어 언덕 회피 경로를 계산할 수 없습니다');
    const notice=missing.length?`${missing.join('. ')}. 실제로 길이 없다는 뜻은 아니며, 현장 확인 자료가 필요합니다.`:'선택 조건을 만족하는 조사 경로가 없습니다. 조건을 자동 완화하지 않습니다.';
    return {...base,status:'NO_MATCHING_ROUTE',routes:[],notice};
  }
  const preferred=request.preference==='FAST'?fast:search(adj,request.originNodeId,request.destinationNodeId,fast.length*request.maxDetourRatio,true)!;
  const same=fast.path.map(a=>a.edge.id).join(',')===preferred.path.map(a=>a.edge.id).join(',');
  const format=(label:Label,labels:string[])=>{
    const points=label.path.flatMap((a,i)=>i===0?a.points:a.points.slice(1));
    const facilityIds=[...new Set(label.path.flatMap(a=>a.edge.facilityIds))];
    const facilities=data.facilities.filter(f=>facilityIds.includes(f.id));
    const lit=label.path.filter(a=>a.lighting==='LIT').reduce((s,a)=>s+a.length,0);
    const dark=label.path.filter(a=>a.lighting==='DARK').reduce((s,a)=>s+a.length,0);
    const unknown=label.path.filter(a=>a.lighting==='UNKNOWN').reduce((s,a)=>s+a.length,0);
    const stale=label.path.some(a=>!isFresh(a.edge.source,now));
    const narrowM=Math.round(label.path.filter(a=>isFresh(a.edge.source,now)&&a.edge.passageWidthM!==undefined&&a.edge.passageWidthM<2).reduce((s,a)=>s+a.length,0));
    const widthUnknownM=Math.round(label.path.filter(a=>!isFresh(a.edge.source,now)||a.edge.passageWidthM===undefined).reduce((s,a)=>s+a.length,0));
    const slopeUnknownM=Math.round(label.path.filter(a=>!isFresh(a.edge.source,now)||a.edge.slopePercent===undefined).reduce((s,a)=>s+a.length,0));
    const accessibilityUnknownM=request.profile==='WALK'?0:Math.round(label.path.filter(a=>!isFresh(a.edge.source,now)||(request.profile==='WHEELCHAIR'?a.edge.wheelchair:a.edge.stroller)==='UNKNOWN').reduce((s,a)=>s+a.length,0));
    const registered=request.dataPolicy==='REFERENCE'&&request.preference==='NIGHT'?data.facilities.filter(f=>f.status!=='BROKEN'&&f.locationKind!=='ADDRESS'&&f.access!=='INDOOR'&&label.path.some(a=>lineDistance(f.position,a.points)<=25)):[];
    return {
      labels,edgeIds:label.path.map(a=>a.edge.id),distanceM:Math.round(label.length),estimatedDurationSec:Math.ceil(label.length),
      timeBasis:{speedMps:1,isAssumed:true,waitingTimeIncluded:false},
      quality:{dataPolicy:request.dataPolicy??'VERIFIED',slopeUnknownM,accessibilityUnknownM,registeredStreetlights:registered.filter(f=>f.type==='STREETLIGHT').length,registeredBells:registered.filter(f=>f.type==='EMERGENCY_BELL').length,registeredCctv:registered.filter(f=>f.type==='CCTV').length},
      detourRatio:Number((label.length/fast.length).toFixed(3)),
      geometry:{type:'LineString',coordinates:points.map(p=>[p.lng,p.lat])},
      lighting:{litM:Math.round(lit),darkM:Math.round(dark),unknownM:Math.round(unknown),observedLitRatio:Number((lit/label.length).toFixed(3))},
      facilities:{streetlights:facilities.filter(f=>f.type==='STREETLIGHT').length,cctv:facilities.filter(f=>f.type==='CCTV').length,emergencyBells:facilities.filter(f=>f.type==='EMERGENCY_BELL').length,ids:facilityIds},
      nightSafety:{narrowM,widthUnknownM,workingStreetlights:facilities.filter(f=>f.type==='STREETLIGHT'&&f.status==='WORKING'&&isFresh(f.source,now)).length,workingBells:facilities.filter(f=>f.type==='EMERGENCY_BELL'&&f.status==='WORKING'&&isFresh(f.source,now)).length},
      segments:label.path.map(a=>({edgeId:a.edge.id,distanceM:Math.round(a.length),lighting:a.lighting,stairs:a.edge.stairs,slopePercent:isFresh(a.edge.source,now)?a.edge.slopePercent:undefined,geometry:a.points.map(p=>[p.lng,p.lat]),constructionIds:a.cautions,source:a.edge.source})),
      warnings:[...(data.isDemo?['시연용 가상 경로입니다. 실제 이동에 사용하지 마세요.']:[]),...(data.edges.some(e=>e.source.type==='OPEN_MAP')?['공개 지도 기반 참고 경로입니다. 실제 보도·진입로·접근성은 현장 미확인입니다.']:[]),'등록된 조명·시설 정보를 참고한 경로이며 실제 밝기나 안전을 보장하지 않습니다.',...(unknown?['조명 정보가 없는 구간이 포함됩니다.']:[]),...(stale?['재확인이 필요한 구간 정보가 있습니다.']:[])],
    };
  };
  const preferenceLabel=request.preference;
  return {...base,status:'OK',routes:same?[format(fast,[...new Set(['FAST',preferenceLabel])])]:[format(fast,['FAST']),format(preferred,[preferenceLabel])],singleRouteReason:same?'SAME_PATH':null};
}
