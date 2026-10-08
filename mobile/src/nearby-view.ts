import type {Coverage, MapItem, Position} from './types';
import {distanceM} from './location';

export const nearbyRadius = 500;
export type NearbyStatus = 'loading' | 'ready' | 'unavailable' | 'stale' | 'data-error';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

export function withinCoverage(p:Position, coverage:Coverage){
  const [west,south,east,north]=coverage.bbox;
  if(p.lng<west||p.lng>east||p.lat<south||p.lat>north)return false;
  const rings=coverage.boundary?.coordinates;
  if(!rings?.length)return true;
  const inRing=(ring:number[][])=>{
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const [x,y]=ring[i],[previousX,previousY]=ring[j];
      if((y>p.lat)!==(previousY>p.lat)&&p.lng<(previousX-x)*(p.lat-y)/(previousY-y)+x)inside=!inside;
    }
    return inside;
  };
  return inRing(rings[0])&&!rings.slice(1).some(inRing);
}

// Archived address matches are not evidence of a light at that location today.
export function nearbyItems(items:MapItem[],center:Position,kind?:string){
  return items.filter(item=>item.locationKind!=='ADDRESS'&&item.status!=='RESOLVED'&&
    (!kind||item.kind===kind||(kind==='CONSTRUCTION'&&item.kind==='CONSTRUCTION_NOTICE'))&&
    distanceM(center,item.position)<=nearbyRadius
  ).sort((a,b)=>distanceM(center,a.position)-distanceM(center,b.position));
}

export function nearbyFacts(items:MapItem[],center:Position){
  const lamps=nearbyItems(items,center,'STREETLIGHT');
  const cameras=nearbyItems(items,center,'CCTV');
  const works=nearbyItems(items,center,'CONSTRUCTION');
  const stairs=nearbyItems(items,center,'STAIRS');
  const closestLamp=lamps[0]?Math.round(distanceM(center,lamps[0].position)):undefined;
  let title='주변 안전시설을 살펴봤어요';
  let message='시설 위치를 확인하고 함께 걸어요.';
  if(works.length){title='근처에 공사 안내가 있어요';message='공사 위치를 확인하고 안심귀갓길을 찾아볼까요?';}
  else if(stairs[0]&&distanceM(center,stairs[0].position)<=50){title='가까운 곳에 계단이 있어요';message='계단 이용이 어렵다면 거동 불편 경로를 확인해보세요.';}
  else if(!lamps.length&&!cameras.length){title='주변 시설 정보가 적어요';message='길의 밝기와 주변을 살피며 이동해주세요.';}
  return {title,message,lamps:lamps.length,cameras:cameras.length,works:works.length,closestLamp};
}

export function nearbyView(input:{status:NearbyStatus;position:Position|null;coverage:Coverage|null;items:MapItem[];error?:string}){
  const {status,position,coverage}=input;
  const ready=status==='ready'&&!!position&&!!coverage;
  const outside=ready&&!withinCoverage(position,coverage);
  const facts=ready&&!outside?nearbyFacts(input.items,position):null;
  const title=facts?.title??(outside?'아직 이 지역 정보는 없어요':status==='loading'?'지금 있는 곳을 살펴볼게요':status==='stale'?'현재 위치를 다시 확인해요':status==='data-error'?'주변 정보를 불러오지 못했어요':'위치를 알려주시면 안내할게요');
  const message=facts?.message??(outside?'월계1동의 안전시설을 안내하고 있어요.':status==='loading'?'위치 정보를 확인하고 있어요.':status==='stale'?'위치 신호가 끊겼어요. 다시 확인해주세요.':status==='data-error'?'인터넷 연결을 확인하고 다시 시도해주세요.':input.error||'위치 권한을 허용하고 다시 시도해주세요.');
  const lampText=facts?(facts.closestLamp===undefined?'등록 정보 없음':`가장 가까운 곳 ${facts.closestLamp}m`):'—';
  const cards=[['STREETLIGHT','가로등',lampText,'<i class="nearby-lamp" aria-hidden="true"></i>'],['CCTV','CCTV',facts?`등록 ${facts.cameras}곳`:'—','<img src="/figma/current/66-571-imgIcon6.svg" alt="">'],['CONSTRUCTION','공사 구간',facts?`안내 ${facts.works}곳`:'—','<img src="/figma/current/66-571-imgIcon7.svg" alt="">']];
  return `<div class="nearby-handle" aria-hidden="true"></div><button class="nearby-close" data-action="nearby-close" aria-label="주변 안내 닫기"><img src="/figma/current/66-571-imgIcon9.svg" alt=""></button>
    <div class="nearby-conversation"><img class="nearby-cat" src="/figma/current/66-571-imgImage1.png" alt="고양이 마을안내원"><div class="nearby-bubble"><small>고양이 마을안내원</small><h2 id="nearby-title">${esc(title)}</h2><p>${esc(message)}</p></div></div>
    <div class="nearby-cards">${cards.map(([kind,label,value,art])=>`<button data-action="nearby-facilities" data-value="${kind}" ${facts?'':'disabled'}><span class="nearby-card-icon">${art}</span><b>${label}</b><small>${value}</small></button>`).join('')}</div>
    <div class="nearby-footer"><small>${facts?'내 위치 주변 500m · 밝기·작동 미확인':outside?'월계1동 밖 · 내 위치는 지도에 표시돼요':'현재 위치 기준 안내'}</small>${facts?'<button data-action="nearby-route">안심귀갓길 찾기 →</button>':`<button data-action="${outside?'map-catalog':'news'}">${outside?'월계1동 시설 보기':'다시 확인'}</button>`}</div>`;
}
