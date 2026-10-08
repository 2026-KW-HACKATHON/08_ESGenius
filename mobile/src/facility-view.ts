import type {MapItem,Construction,ConstructionNotice,ConstructionCatalog} from './types';
import {markerStyle} from './map-items';

const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const facts=(rows:[string,string][])=>'<dl class="facility-facts">'+rows.map(([label,value])=>`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`).join('')+'</dl>';
const heading=(kind:string,name:string)=>{const style=markerStyle(kind);return `<div class="facility-heading ${style.tone}"><span class="symbol-art">${style.icon}</span><div><small>총총 우리 동네 지도</small><h2>${style.label}</h2></div></div><h3 class="facility-name">${esc(name)}</h3>`;};
const sourceLink=(url?:string)=>url&&/^https:\/\//.test(url)?`<a class="facility-source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">원자료에서 확인 ↗</a>`:'';
const position=(p:MapItem['position'])=>`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;

export function facilityView(item:MapItem){
  const name=(item.name||item.title||markerStyle(item.kind).label).replace('주민센타','주민센터');
  const address=item.description?.split('/').map(s=>s.trim()).find(s=>/^서울(?:특별시)?\s/.test(s));
  const hours=item.openingHours?.replace(/^정시\((.*)\)$/,'$1').replace('영업시작~종료','영업시간 내').replace(/^(.*),평일$/,'평일 $1').replaceAll('~','–');
  const rows:[string,string][]=[['위치','월계1동 · '+position(item.position)]];
  if(address)rows.push(['주소',address]);
  if(item.locationKind==='ADDRESS')rows.push(['위치 기준','과거 설치 주소']);
  if(item.access==='INDOOR')rows.push(['설치 장소','실내']);
  if(hours)rows.push(['이용 시간',hours]);
  if(item.status==='BROKEN')rows.push(['상태','고장 신고됨']);
  rows.push(['자료 기준',item.source?.observedAt?.slice(0,10)||'미확인'],['출처',item.source?.name||'등록 자료']);
  return heading(item.kind,name)+facts(rows)+`<div class="facility-actions"><button data-action="map-item-focus" data-value="${esc(item.id)}">지도에서 보기</button><button data-action="map-item-route" data-value="${esc(item.id)}">여기로 길찾기</button></div>`+sourceLink(item.source?.url);
}

export function constructionNoticeView(n:ConstructionNotice,c:ConstructionCatalog){
  const rows:[string,string][]=[['위치',n.position?position(n.position):'위치 미확인'],['위치 기준',n.locationKind==='PROJECT_POINT'?'사업 대표 위치 · 지도 안내용':'공사 주소 기준점'],['등록 기간',n.startsOn+' – '+n.endsOn],['자료 기준',(n.collectedAt??c.collectedAt)?.slice(0,10)||'미확인'],['출처',n.sourceName??c.sourceName]];
  return heading('CONSTRUCTION',n.title)+facts(rows)+`<div class="facility-actions">${n.position?`<button data-action="notice-map" data-value="${esc(n.id)}">지도에서 보기</button>`:''}<button data-action="construction-replan">공사 피해 길찾기</button></div>`+sourceLink(n.sourceUrl??c.sourceUrl);
}

export function constructionView(c:Construction,status:string){
  const rows:[string,string][]=[['위치',position(c.position)],['상태',status],['시작',c.startsAt.slice(0,10)]];
  if(c.expectedEndAt)rows.push(['종료 예정',c.expectedEndAt.slice(0,10)]);
  rows.push(['자료 기준',c.source?.observedAt?.slice(0,10)||'미확인'],['출처',c.source?.name||'등록 자료']);
  return heading('CONSTRUCTION',c.title)+facts(rows)+`<div class="facility-actions"><button data-action="construction-map" data-value="${esc(c.id)}">지도에서 보기</button><button data-action="construction-replan">공사 피해 길찾기</button></div>`+sourceLink(c.source?.url);
}
