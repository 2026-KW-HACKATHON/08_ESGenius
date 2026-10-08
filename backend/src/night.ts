import { distance, lineDistance } from './geo.js';
import { isFresh } from './routing.js';
import type { Dataset, NightCheck, Position } from './schemas.js';
export function nearbyFacilities(data:Dataset,position:Position,radiusM=500,now=new Date()) {
  return data.facilities.map(f=>({...f,distanceM:distance(position,f.position),needsRecheck:!isFresh(f.source,now)})).filter(f=>f.distanceM<=radiusM).sort((a,b)=>a.distanceM-b.distanceM).map(f=>({...f,distanceM:Math.round(f.distanceM),distanceType:'STRAIGHT_LINE'}));
}
export function checkNight(data:Dataset,input:NightCheck,now=new Date()) {
  const age=+now-+new Date(input.measuredAt);
  if(input.accuracyM>50||age>30000||age< -5000)return {state:'PAUSED',reason:input.accuracyM>50?'LOW_ACCURACY':'STALE_LOCATION',alerts:[],isDemo:data.isDemo};
  const recent=new Map(input.recentAlerts.map(a=>[a.facilityId,+new Date(a.alertedAt)]));
  const alerts=nearbyFacilities(data,input.position,50,now).filter(f=>+now-(recent.get(f.id)??0)>=60000).slice(0,3).map(f=>({
    facilityId:f.id,type:f.type,distanceM:f.distanceM,position:f.position,
    message:`약 ${f.distanceM}m 부근에 ${f.name}이 등록되어 있어요.${f.needsRecheck?' 최신 정보 재확인이 필요해요.':''}${f.status==='BROKEN'?' 고장으로 등록되어 있어요.':''}`,
    source:f.source,status:f.status,alertedAt:now.toISOString(),
  }));
  const warnings=data.edges.filter(e=>e.lighting==='DARK'&&lineDistance(input.position,e.geometry)<=50).map(e=>({
    edgeId:e.id,distanceM:Math.round(lineDistance(input.position,e.geometry)),needsRecheck:!isFresh(e.source,now),
    message:isFresh(e.source,now)?'주변 구간에 조명 부족 정보가 등록되어 있어요.':'주변 구간의 조명 부족 정보는 재확인이 필요해요.',source:e.source,
  }));
  // Location and cooldown state are not persisted on the server.
  return {state:'ACTIVE',alerts,warnings,isDemo:data.isDemo};
}
