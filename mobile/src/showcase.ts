import type {Node} from './types';
import type {RoutingOptions} from './route-conditions';

const bridge:Node={id:'1795192360',name:'장월교 인근 보행길',position:{lat:37.6179636,lng:127.0572659}};
const station:Node={id:'414687714',name:'석계역 인근 보행길',position:{lat:37.6148731,lng:127.0648373}};
export const showcases=[
  {id:'comfort',title:'거동 불편 · 계단 우회 비교',description:'장월교 인근 → 석계역 · 최단길과 계단 없는 참고 경로 비교',origin:bridge,destination:station},
  {id:'night',title:'안심귀갓길 · 조명과 CCTV',description:'석계역 인근 → 광운대역 인근 · 등록 가로등과 CCTV 위치 확인',origin:{id:'1939144238',name:'석계역 서쪽 보행길',position:{lat:37.614565,lng:127.0637752}},destination:{id:'8502115869',name:'광운대역 남쪽 보행길',position:{lat:37.6223297,lng:127.0614422}}},
  {id:'wheelchair',title:'휠체어 · 참고 경로 미리보기',description:'장월교 인근 → 석계역 · 계단 제외, 미확인 통행 정보 표시',origin:bridge,destination:station},
  {id:'construction',title:'공사 우회 · 짧은 우회 경로',description:'월계동 298 남쪽 → 북쪽 보행길 · 전주 이설공사 주소 주변 우회',origin:{id:'436855625',name:'월계동 298 남쪽 보행길',position:{lat:37.6282021,lng:127.059198}},destination:{id:'3834716379',name:'월계동 298 북쪽 보행길',position:{lat:37.6286709,lng:127.0591881}}},
] as const;
export function showcaseOptions(id:string):RoutingOptions {
  const mobility=id==='comfort'||id==='wheelchair';
  return {profile:id==='wheelchair'?'WHEELCHAIR':'WALK',night:id==='night',comfort:mobility,stairs:mobility,slopes:mobility,verifiedOnly:false};
}
export function showcaseView(){return '<p class="notice">기능을 비교할 구간을 골라보세요.</p>'+showcases.map(s=>'<button class="showcase-choice" data-action="showcase-open" data-value="'+s.id+'"><b>'+s.title+'</b><span>'+s.description+'</span><small>참고 경로 열기 →</small></button>').join('')+'<p class="small">참고 경로 · 실제 통행 상태는 현장 확인이 필요해요.</p>';}
