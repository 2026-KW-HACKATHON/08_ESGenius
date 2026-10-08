import {routeSummary,routeError,routeMore} from './route-copy';
import type { Node, Route, Search } from './types';
import { daylight } from './navigation';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const icon=(n:number)=>`<img src="/figma/current/66-2115-imgIcon${n||''}.svg" alt="">`;
const name=(n:Node|null)=>n?(n.name.startsWith('지도 연결점')?'선택한 연결점':n.name):'선택해주세요';
export const distanceLabel=(m:number)=>m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`;
export const eta=(seconds:number)=>new Date(Date.now()+seconds*1000).toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
export type RouteViewState={verifiedOnly?:boolean;connections?:{offsetM:number}[];demo?:boolean;transport?:string;origin:Node|null;destination:Node|null;profile:Search['profile'];night:boolean;nightAuto:boolean;comfort:boolean;stairs:boolean;slopes:boolean;busy:boolean;error:string;guiding:boolean;routes:Route[];index:number};

export function routeHeader(s:RouteViewState){
  if(s.guiding)return `<div class="navigation-banner"><span id="guide-arrow" class="navigation-direction" aria-hidden="true">↑</span><div><b id="guide-title">${s.night?'노란 안심 경로를 따라 이동하세요':'초록 경로를 따라 이동하세요'}</b><small id="guide-subtitle">${s.demo?'실제 도로 · 위치 재현':s.night?'반딧불이가 앞에서 함께해요':'고양이와 함께 걷는 낮길'}</small></div></div><button class="navigation-close" data-action="stop" aria-label="안내 종료">×</button>`;
  return `<button data-action="route-close" aria-label="경로 안내 뒤로"><img src="/figma/current/66-1697-imgIcon.svg" alt=""></button><h1>경로 안내</h1>${s.demo?'<button data-action="demo-exit" class="demo-badge">시연 모드 ×</button>':'<span></span>'}`;
}

export function routePanel(s:RouteViewState,preview:boolean,constructionNotice:string){
  const r=s.routes[s.index];
  if(s.guiding&&r)return `<div class="navigation-summary"><div><strong id="remaining-time">${Math.ceil(r.estimatedDurationSec/60)}분</strong><small id="remaining-distance">남은 거리 ${distanceLabel(r.distanceM)}</small></div><span id="arrival-time">${eta(r.estimatedDurationSec)} 도착</span></div><progress id="route-progress" value="0" max="100" aria-label="경로 진행률"></progress><div class="navigation-instruction"><span><img src="/figma/guide-walk.svg" alt=""></span><div><b id="guide-message" role="status">${s.night?'반딧불이와 함께 출발해요':'고양이와 함께 출발해요'}</b><small id="facility-message">주변 보행 상태를 확인하며 이동하세요</small></div></div>${preview?'<p class="preview-label">'+(s.demo?'실제 도로 · 위치 재현 · ':'')+(s.demo?'보행 속도 1.3m/s':'이동 미리보기 · 5배속')+'</p>':'<p class="navigation-footnote">위치와 남은 거리는 GPS 정확도에 따라 달라질 수 있어요.</p>'}<button id="replan-current" class="primary" data-action="replan-current" hidden>현재 위치에서 다시 찾기</button><div class="navigation-bottom"><button data-action="help">안심 도움</button><button data-action="stop">${preview?'미리보기 종료':'안내 종료'}</button></div>`;
  const transit=s.transport==='TRANSIT';
  const screen=transit?'66-2002':s.profile!=='WALK'?'66-2454':s.transport==='ALL'?'66-1889':s.comfort?'66-2228':s.night?'66-2341':'66-2115';
  const transportIcon=(n:number)=>`<img src="/figma/current/${screen}-imgIcon${n}.svg" alt="">`; 
  const transitUrl=s.origin&&s.destination?'https://map.kakao.com/link/by/traffic/'+encodeURIComponent(name(s.origin))+','+s.origin.position.lat+','+s.origin.position.lng+'/'+encodeURIComponent(name(s.destination))+','+s.destination.position.lat+','+s.destination.position.lng:'';
  const mode=s.night?'NIGHT':s.comfort?'COMFORT':'FAST';
  const summary=routeSummary(s,r);
  const sunset=daylight().sunset.toLocaleTimeString('ko-KR',{timeZone:'Asia/Seoul',hour:'2-digit',minute:'2-digit',hour12:false});
  return `<div class="route-handle" aria-hidden="true"></div>${s.demo?'<p class="demo-note">시연 경로 · 실제 통행 상태는 별도 확인</p>':''}
    <div class="transport-tabs" aria-label="이동 방식">
      <button data-action="transport" data-value="ALL" class="${s.transport==='ALL'?'active':''}" aria-pressed="${s.transport==='ALL'}" aria-label="전체 경로">${transportIcon(5)}<span>전체</span></button>
      ${s.demo?`<button data-action="transport" data-value="STROLLER" aria-pressed="${s.profile==='STROLLER'}" class="${s.profile==='STROLLER'?'active':''}">${transportIcon(8)}<span>유모차</span></button>`:`<button data-action="transit-info" class="${transit?'active':''}" aria-pressed="${transit}" aria-label="대중교통 경로">${transportIcon(6)}<span>대중교통</span></button>`}
      <button data-action="transport" data-value="WALK" class="${s.profile==='WALK'&&!transit&&s.transport!=='ALL'?'active':''}" aria-pressed="${s.profile==='WALK'&&!transit&&s.transport!=='ALL'}">${transportIcon(7)}<span>걸어서</span></button>
      <button data-action="transport" data-value="WHEELCHAIR" class="${!transit&&(s.demo?s.profile==='WHEELCHAIR':s.profile!=='WALK')?'active':''}" aria-pressed="${!transit&&(s.demo?s.profile==='WHEELCHAIR':s.profile!=='WALK')}">${transportIcon(8)}<span>${s.profile==='STROLLER'&&!s.demo?'유모차':'휠체어'}</span></button>
    </div>
    <div class="route-destination"><button data-action="pick" data-value="destination" aria-label="도착지 선택"><b>${s.destination?esc(name(s.destination)):'어디로 갈까요?'}</b><small>${r?distanceLabel(r.distanceM)+' · ':''}월계1동 보행길</small></button><button class="route-save" data-action="save" aria-label="경로 저장" ${r?'':'disabled'}><img src="/figma/current/66-2115-imgButton.svg" alt=""></button></div>
    <button class="route-origin" data-action="pick" data-value="origin">출발 <span>${esc(name(s.origin))}</span><span aria-hidden="true">›</span></button>
    ${transit?`<section class="transit-result"><strong>대중교통 경로</strong><p>버스·지하철 경로는 카카오맵에서 확인하세요.</p>${transitUrl?`<a class="primary" href="${esc(transitUrl)}" target="_blank" rel="noopener noreferrer">카카오맵에서 경로 보기 ↗</a>`: `<p class="small">출발지와 도착지를 먼저 선택해주세요.</p>`}</section>`:''}<div class="walking-result ${transit?'transit-hidden':''}"><div class="preference-tabs" aria-label="경로 조건" ${s.profile!=='WALK'?'hidden':''}>${[['FAST','최단거리'],['COMFORT','거동 불편'],['NIGHT','안심귀갓길']].map(([v,label])=>`<button data-action="route-preference" data-value="${v}" class="${mode===v?'active':''} ${v==='NIGHT'?'night-preference':''}" aria-pressed="${mode===v}">${v==='NIGHT'?(s.night?'<img src="/figma/current/66-2341-imgIcon9.svg" alt="">':icon(9)):''}${label}</button>`).join('')}</div>
    ${s.error?`<p class="route-error" role="alert">${esc(routeError(s.error))}</p>`:''}
    ${(s.comfort||s.profile!=='WALK')&&!s.demo?`<div class="route-data-policy"><span>${s.verifiedOnly?'확인된 길만':'참고 경로 · 통행 확인 필요'}</span><button data-action="data-policy" data-value="${s.verifiedOnly?'REFERENCE':'VERIFIED'}">${s.verifiedOnly?'참고 경로 보기':'확인된 길만'}</button></div>`:''}
    ${r?`<div class="figma-route-result ${s.night?'night-result':s.profile!=='WALK'?'mobility-result':''}"><img class="route-companion" src="/figma/current/${s.night?'66-2341-imgImage1.png':s.profile!=='WALK'?'66-2454-imgImage1.png':'66-2115-imgImage1.png'}" alt="${s.night?'반딧불이 동행 캐릭터':s.profile!=='WALK'?'핑크 날개말 길안내 캐릭터':'고양이 길안내 캐릭터'}"><div><strong>${Math.ceil(r.estimatedDurationSec/60)}분</strong><small>${esc(summary)}</small></div><button data-action="start" ${s.busy?'disabled':''}>안내</button></div>${r.constructionDetour?.avoided.length?'<p class="route-status-note">공사 구간 우회</p>':''}${s.night&&r.lighting.unknownM?'<p class="route-status-note">점등 상태 미확인</p>':''}${!s.demo?'<button class="secondary route-direct-preview" data-action="preview-route">경로 미리보기</button>':''}${routeMore(s,r,sunset,constructionNotice)}`:`<div class="route-empty">${s.busy?'경로를 찾고 있어요…':s.error?'':'출발지와 도착지를 선택해주세요.'}</div><div class="route-utilities"><button data-action="options">이동 조건</button><button data-action="constructions">공사 안내</button></div>`}</div>${s.transport==='ALL'&&transitUrl?`<a class="transit-link" href="${esc(transitUrl)}" target="_blank" rel="noopener noreferrer">버스 · 지하철 경로도 확인하기 ↗</a>`:''}`;
}
