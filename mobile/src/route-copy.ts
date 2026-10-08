import type {Route} from './types';
import type {RouteViewState} from './route-view';
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const distance=(m:number)=>m>=1000?`${(m/1000).toFixed(1)}km`:`${Math.round(m)}m`;

export function routeSummary(s:RouteViewState,r?:Route){
  if(!r)return '';
  if(r.constructionDetour?.avoided.length&&!s.night)return `${distance(r.distanceM)} · 공사 ${r.constructionDetour.avoided.length}곳 우회`;
  if(s.night){const q=r.quality;return [['가로등',q?.registeredStreetlights??r.facilities.streetlights],['CCTV',q?.registeredCctv??r.facilities.cctv],['안심벨',q?.registeredBells??r.facilities.emergencyBells??0]].filter(([,count])=>Number(count)>0).map(([label,count])=>`${label} ${count}곳`).join(' · ')||'등록 시설 정보 없음';}
  return s.comfort||s.profile!=='WALK'?'등록 계단·급경사 우회':`${distance(r.distanceM)} · 가장 짧은 길`;
}
export function routeError(message:string){
  if(message.includes('통행 가능 여부가 확인된'))return '통행이 확인된 경로가 없어요. 참고 경로를 확인해보세요.';
  if(message.includes('유효한 경사 정보가 없어'))return '경사 정보가 부족해요. 참고 경로를 확인해보세요.';
  if(message.includes('선택 조건을 만족하는'))return '조건에 맞는 경로가 없어요. 이동 조건을 바꿔주세요.';
  return message;
}
export function routeMore(s:RouteViewState,r:Route,sunset:string,constructionNotice:string){
  const unknown=r.quality;
  return `<details class="route-auxiliary"><summary>경로 자세히</summary>
    <div class="route-utilities"><button data-action="options">이동 조건</button><button data-action="constructions">공사 안내</button></div>
    <dl class="route-facts"><dt>예상 시간</dt><dd>초당 1m 보행 기준</dd><dt>등록 계단</dt><dd>${(r.segments??[]).filter(s=>s.stairs).length}구간</dd>
    ${unknown?.slopeUnknownM?`<dt>경사 미확인</dt><dd>${distance(unknown.slopeUnknownM)}</dd>`:''}
    ${unknown?.accessibilityUnknownM?`<dt>통행 미확인</dt><dd>${distance(unknown.accessibilityUnknownM)}</dd>`:''}
    ${s.night&&r.lighting.unknownM?`<dt>조명 미확인</dt><dd>${distance(r.lighting.unknownM)}</dd>`:''}
    ${s.connections?.some(c=>c.offsetM>0)?`<dt>도로 연결</dt><dd>출발 ${s.connections[0].offsetM}m · 도착 ${s.connections.at(-1)!.offsetM}m</dd>`:''}</dl>
    ${!s.demo?'<p>출입구·도로 진입 구간은 안내에서 제외됩니다.</p>':''}
    ${s.comfort||s.profile!=='WALK'?'<p>등록된 계단·급경사를 피합니다. 미확인 구간의 통행 가능 여부는 현장 확인이 필요합니다.</p>':''}
    ${s.night?'<p>시설 수는 경로 주변의 등록 위치 기준입니다. 현재 작동 여부는 미확인입니다.</p>':''}
    ${r.constructionDetour?.avoided.length?`<p>공사 ${r.constructionDetour.avoided.length}곳 우회 · ${distance(r.constructionDetour.extraDistanceM)} 추가</p>`:''}
    ${constructionNotice?`<p>${esc(constructionNotice)}</p>`:''}
    <button class="route-sunset" data-action="night" aria-label="안심귀갓길 자동 전환 설정">오늘 일몰 ${sunset}<span>${s.nightAuto?'자동 전환':'수동 전환'} ›</span></button>
  </details>`;
}
