import {distance,insideDataset,lineLength} from './geo.js';
import {activeConstructions,edgeExclusion} from './routing.js';
import {constructionPlan,constructionRoutes} from './construction-routing.js';
import {journeyRoutes} from './journey.js';
import {ApiError} from './errors.js';
import type {Construction,Dataset,RoutePlan,RouteRequest} from './schemas.js';

export const MAX_CONNECTION_M=100;
type Candidate=Dataset['nodes'][number]&{offset:number};
type Arc={to:string;length:number};
// One shortest-path tree resolves all candidate destinations, respecting direction.
function distances(adj:Map<string,Arc[]>,origin:string){
  const costs=new Map<string,number>([[origin,0]]),heap:[number,string][]=[[0,origin]];
  const push=(item:[number,string])=>{let i=heap.length;heap.push(item);while(i){const p=(i-1)>>1;if(heap[p]![0]<=item[0])break;heap[i]=heap[p]!;i=p;}heap[i]=item;};
  while(heap.length){const [cost,id]=heap[0]!,last=heap.pop()!;if(heap.length){let i=0;while(i*2+1<heap.length){let c=i*2+1;if(c+1<heap.length&&heap[c+1]![0]<heap[c]![0])c++;if(heap[c]![0]>=last[0])break;heap[i]=heap[c]!;i=c;}heap[i]=last;}if(cost>costs.get(id)!)continue;
    for(const arc of adj.get(id)??[]){const next=cost+arc.length;if(next<(costs.get(arc.to)??Infinity)){costs.set(arc.to,next);push([next,arc.to]);}}
  }
  return costs;
}

export function planRoute(data:Dataset,controls:Construction[],input:RoutePlan,revision:string,now=new Date()){
  const positions=[input.origin,...(input.via??[]),input.destination];
  if(positions.some(p=>!insideDataset(p,data)))throw new ApiError(422,'OUT_OF_COVERAGE','월계1동 경계 안의 출발지·경유지·도착지를 선택해주세요.');
  if(positions.some((p,i)=>positions.some((q,j)=>j<i&&distance(p,q)<2)))throw new ApiError(400,'DUPLICATE_WAYPOINT','출발지, 경유지, 도착지는 서로 다른 장소를 선택해주세요.');
  const conditions={profile:input.profile,avoidStairs:input.avoidStairs,avoidSlopes:input.avoidSlopes,preference:input.preference,dataPolicy:input.dataPolicy,maxDetourRatio:input.maxDetourRatio};
  const plan=constructionPlan(data,controls,now);
  const blocked=new Set([...plan.entries.flatMap(e=>e.edgeIds),...activeConstructions(controls,now).filter(c=>c.impact==='BLOCK').flatMap(c=>c.edgeIds)]);
  const adj=new Map<string,Arc[]>(),eligibleNodes=new Set<string>();
  for(const edge of data.edges){if(blocked.has(edge.id)||edgeExclusion(edge,conditions,now))continue;const length=lineLength(edge.geometry);if(length<.01)continue;
    const add=(a:string,b:string)=>{adj.set(a,[...(adj.get(a)??[]),{to:b,length}]);eligibleNodes.add(a);eligibleNodes.add(b);};
    add(edge.from,edge.to);if(edge.bidirectional)add(edge.to,edge.from);
  }
  const candidates=positions.map(p=>data.nodes.map(n=>({...n,offset:distance(p,n.position)})).filter(n=>n.offset<=MAX_CONNECTION_M&&eligibleNodes.has(n.id)).sort((a,b)=>a.offset-b.offset));
  const nearest=positions.map(p=>data.nodes.reduce((best,n)=>distance(p,n.position)<distance(p,best.position)?n:best));
  const failure=()=>{
    const result=constructionRoutes(data,controls,{...conditions,originNodeId:nearest[0]!.id,destinationNodeId:nearest.at(-1)!.id},revision,now);
    return {...result,status:'NO_MATCHING_ROUTE',routes:[],connections:[],notice:!eligibleNodes.size?(result.notice??'선택 조건을 확인할 수 있는 보행 구간이 없습니다.'):`장소 주변 ${MAX_CONNECTION_M}m 안에서 선택 조건으로 이어지는 도로를 찾지 못했어요. 지도에서 가까운 출입구를 선택해주세요.`};
  };
  if(candidates.some(c=>!c.length))return failure();
  type Choice={stops:Candidate[];offset:number;length:number};
  let choices:Choice[]=candidates[0]!.map(n=>({stops:[n],offset:n.offset,length:0}));
  const cache=new Map<string,Map<string,number>>();
  for(let i=1;i<candidates.length;i++){
    const next:Choice[]=[];
    for(const to of candidates[i]!){let best:Choice|undefined;
      for(const choice of choices){if(choice.stops.some(n=>n.id===to.id))continue;const from=choice.stops.at(-1)!;let tree=cache.get(from.id);if(!tree){tree=distances(adj,from.id);cache.set(from.id,tree);}const length=tree.get(to.id);if(length===undefined)continue;
        const option={stops:[...choice.stops,to],offset:choice.offset+to.offset,length:choice.length+length};
        if(!best||option.offset<best.offset-1||Math.abs(option.offset-best.offset)<=1&&option.length<best.length)best=option;
      }
      if(best)next.push(best);
    }
    choices=next;if(!choices.length)return failure();
  }
  choices.sort((a,b)=>Math.abs(a.offset-b.offset)>1?a.offset-b.offset:a.length-b.length);
  const stops=choices[0]!.stops;
  const resolvedSearch:RouteRequest={...conditions,originNodeId:stops[0]!.id,destinationNodeId:stops.at(-1)!.id,viaNodeIds:stops.slice(1,-1).map(n=>n.id)};
  const result=journeyRoutes(data,controls,resolvedSearch,revision,now);
  // Geometry starts/ends on real graph nodes. No invented straight-line connectors.
  const connections=stops.map((node,i)=>({nodeId:node.id,position:node.position,requestedPosition:positions[i]!,offsetM:Math.round(node.offset),connectorSurveyed:false}));
  return {...result,resolvedSearch,connections};
}
