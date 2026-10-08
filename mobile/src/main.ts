import {nearbyView,nearbyItems,nearbyRadius,withinCoverage,type NearbyStatus} from './nearby-view';
import {facilityView,constructionNoticeView,constructionView} from './facility-view';
import {showcases,showcaseOptions,showcaseView} from './showcase';
import {mapKinds,markerStyle,layerKind,visibleItems,kindCount} from './map-items';
import { demoOrigin, demoDestination, presentationRoute, presentationFacilities, presentationConstruction } from './demo-route';
import './style.css';
import './route.css';
import './wireframe.css';
import './map-items.css';
import './nearby.css';
import {asset,icon,preferences,writeLocal,historyPlaces,rememberPlace,savedPlaces,toggleSavedPlace,reportTypes,reportStatuses,reportCard,reportList,profileView,placeRows,searchView,plannerView,reportForm,preparePhoto,timeAgo,type Place,type Preferences} from './wireframe';
import { routePanel, routeHeader, distanceLabel, eta } from './route-view';
import { daylight, routeProgress, nextManeuver } from './navigation';
import {routeConditions,selectPreference} from './route-conditions';
import { installApp } from './pwa';
import { constructionStatus, constructionCautions, constructionSummary } from './constructions';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { Geolocation } from '@capacitor/geolocation';
import { createClient } from '@supabase/supabase-js';
import { Api, ApiError } from './api';
import { loadSettings, saveSettings, validApiUrl, validKakaoKey } from './settings';
import { WalkingMap, loadKakao } from './map';
import { distanceM, usableFix } from './location';
import type { Coverage, Node, Position, MapItem, Report, Route, Routes, Saved, Search, Construction, ConstructionCatalog, ConstructionNotice } from './types';

const $=<T extends HTMLElement=HTMLElement>(selector:string)=>document.querySelector<T>(selector)!;
const esc=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const types=reportTypes;
const statuses=reportStatuses;
const filmMode=new URLSearchParams(location.search).get('film')==='1';
const demoMode=filmMode||new URLSearchParams(location.search).get('demo')==='1';
const state={verifiedOnly:false,connections:[] as NonNullable<Routes['connections']>,demo:demoMode,demoConstruction:false,excludedConstruction:0,routeOpen:false,transport:'WALK',tab:'map',coverage:null as Coverage|null,origin:null as Node|null,destination:null as Node|null,routes:[] as Route[],index:0,version:'',items:[] as MapItem[],profile:'WALK' as Search['profile'],night:daylight().night,nightAuto:true,comfort:false,slopes:false,stairs:false,error:'',busy:false,user:null as {subject:string;admin:boolean;nickname?:string;district?:string}|null,filter:'',reports:[] as Report[],nextOffset:null as number|null,saved:[] as Saved[],selected:null as Position|null,guiding:false,position:null as Position|null,positionAt:0,positionAccuracy:Infinity};
let api:Api,map:WalkingMap|undefined,watch:string|undefined,watchGeneration=0,routeGeneration=0,refreshTimer:ReturnType<typeof setInterval>|undefined,lastFix=0,lastFacilityCheck=0,checking=false;
let previewTimer:ReturnType<typeof setInterval>|undefined;
let previewing=false;
let nearbyStatus:NearbyStatus='loading',nearbyError='',nearbyGeneration=0,itemsLoaded=false;
let mapWatch:string|undefined,mapWatchPending=false,mapWatchGeneration=0,mapTrackingRequested=false;
let fixExpiry:ReturnType<typeof setTimeout>|undefined;
function freshPosition(){return !!state.position&&usableFix(state.positionAccuracy,state.positionAt);}
function closeNearby(){++nearbyGeneration;$('#nearby-panel').hidden=true;$('#map-page').classList.remove('nearby-open');}
function renderNearby(){
  const panel=$('#nearby-panel');if(panel.hidden)return;
  const html=nearbyView({status:nearbyStatus,position:state.position,coverage:state.coverage,items:state.items,error:nearbyError});
  if(panel.innerHTML!==html)panel.innerHTML=html;
}
function expirePosition(){
  state.positionAccuracy=Infinity;
  if(!previewing&&state.position)map?.position(state.position,false,'위치 갱신 필요');
  nearbyStatus='stale';renderNearby();
}
function acceptPosition(position:Position,timestamp:number,accuracy:number,center=false){
  state.position=position;state.positionAt=timestamp;state.positionAccuracy=accuracy;
  if(!previewing)map?.position(position,center||(!$('#nearby-panel').hidden&&!$<HTMLDialogElement>('#sheet').open));
  clearTimeout(fixExpiry);fixExpiry=setTimeout(expirePosition,Math.max(0,30001-(Date.now()-timestamp)));
  nearbyStatus=itemsLoaded?'ready':'data-error';renderNearby();
}
async function stopMapWatch(clearIntent=true){
  if(clearIntent)mapTrackingRequested=false;
  ++mapWatchGeneration;const id=mapWatch;mapWatch=undefined;
  if(id)await Geolocation.clearWatch({id});
}
async function startMapWatch(){
  if(mapWatch||mapWatchPending||document.hidden||state.tab!=='map'||state.routeOpen||!preferences.location)return;
  mapTrackingRequested=true;mapWatchPending=true;const generation=++mapWatchGeneration;
  try{
    const id=await Geolocation.watchPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0,minimumUpdateInterval:3000},(pos,error)=>{
      if(generation!==mapWatchGeneration)return;
      if(error||!pos){expirePosition();void stopMapWatch();return;}
      if(!usableFix(pos.coords.accuracy,pos.timestamp))return;
      acceptPosition({lat:pos.coords.latitude,lng:pos.coords.longitude},pos.timestamp,pos.coords.accuracy);
    });
    if(generation!==mapWatchGeneration)await Geolocation.clearWatch({id});else mapWatch=id;
  }catch{if(generation===mapWatchGeneration)expirePosition();}
  finally{mapWatchPending=false;}
}
let pendingReport:{key:string;body:string}|undefined;
const layers=new Set<string>(mapKinds.map(([kind])=>kind));
const recent:Array<{facilityId:string;alertedAt:string}>=[];
const supabaseUrl=import.meta.env.VITE_SUPABASE_URL,anonKey=import.meta.env.VITE_SUPABASE_ANON_KEY;
const auth=supabaseUrl&&anonKey?createClient(supabaseUrl,anonKey,{auth:{persistSession:false,autoRefreshToken:true,detectSessionInUrl:false}}):null;
auth?.auth.onAuthStateChange((_event,session)=>{if(api)api.token=session?.access_token||'';if(!session)state.user=null;});
let viaNodes:Node[]=[];
let planning=false,searchSide='destination',mapPicking='',selectedPlace:Place|null=null;
let searchResults:Place[]=[];
let reportDraft={type:'ROAD_DAMAGE',description:'',photos:[] as string[]};
let photosBusy=false;
let resumeReport=false,miniMap:WalkingMap|undefined;
let toastTimer:ReturnType<typeof setTimeout>;
function toast(message:string){const el=$('#toast');const host=Array.from(document.querySelectorAll('dialog[open]')).at(-1)??document.body;host.append(el);el.textContent=message;el.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove('show'),5500);}
function sheet(title:string,html:string,kind=''){
  miniMap?.destroy();miniMap=undefined;
  document.body.append($('#toast'));
  const full=['제보 작성','제보 상세','장소 검색','길찾기','내가 쓴 글','공감한 글','저장한 장소'].includes(title);
  const dialog=$<HTMLDialogElement>('#sheet');dialog.className=kind||(full?'screen-sheet':'');
  $('#sheet-title').textContent=title;$('#sheet-body').innerHTML=html;dialog.scrollTop=0;
  if(!dialog.open)dialog.showModal();
}
function close(){document.body.append($('#toast'));$<HTMLDialogElement>('#feedback').close();miniMap?.destroy();miniMap=undefined;$<HTMLDialogElement>('#sheet').close();}
function showPlanner(){closeNearby();planning=true;sheet('길찾기',plannerView(state.origin,state.destination,viaNodes)+'<button class="showcase-entry" data-action="showcase">시연 추천 경로 보기 →</button>');}
function openSearch(side='destination'){searchSide=side;sheet('장소 검색',searchView());}
async function runSearch(query:string){searchResults=[];const result=await api.call<{items:Place[];notice?:string}>('/places?q='+encodeURIComponent(query));searchResults=result.items;sheet('장소 검색',searchView(query,searchResults,result.notice));}
function renderMiniMap(id:string,position:Position|null){const el=document.getElementById(id);if(!el)return;if(!position){el.innerHTML='<span>지도에서 제보 위치를 선택해주세요.</span>';return;}if(!state.coverage||!window.kakao?.maps?.Map){el.innerHTML='<span>선택 위치 '+position.lat.toFixed(5)+', '+position.lng.toFixed(5)+'</span>';return;}el.replaceChildren();miniMap=new WalkingMap(el,state.coverage,()=>{});miniMap.selectedPosition(position);miniMap.focusPoint(position);}
function captureDraft(){const f=document.querySelector<HTMLFormElement>('[data-form=report]');if(f){const d=new FormData(f);reportDraft.description=String(d.get('description')||'');reportDraft.type=String(d.get('type')||'ROAD_DAMAGE');}}
function savedPlacesView(){sheet('저장한 장소','<p class="small">이 기기에 저장한 장소예요.</p><div class="place-list">'+(savedPlaces().length?placeRows(savedPlaces(),'saved-place'):'<p class="empty">장소 검색에서 별을 눌러 저장해보세요.</p>')+'</div>');}
function layerMenu(refresh=false){const el=$('#layer-menu');if(!refresh)el.hidden=!el.hidden;$('[data-action=layers]').setAttribute('aria-expanded',String(!el.hidden));el.innerHTML='<h3>지도에 표시할 정보</h3>'+[['saved','저장된 장소'],['safety','주변 안전정보']].map(([key,label])=>'<div><span>'+label+'</span><button class="switch" role="switch" aria-label="'+label+'" aria-checked="'+preferences[key as keyof Preferences]+'" data-action="preference" data-value="'+key+'"><span></span></button></div>').join('')+'<hr class="layer-divider">'+mapKinds.map(([kind,label])=>'<button class="layer-kind '+markerStyle(kind).tone+'" data-action="layer" data-value="'+kind+'" aria-pressed="'+layers.has(kind)+'"><b>'+label+'</b><small>'+kindCount(state.items,kind)+'</small><span class="layer-check">✓</span></button>').join('')+'<button class="secondary" data-action="map-catalog">시설 목록·자료 출처</button>';}
function facilityList(kind=''){const rows=state.items.filter(i=>!kind||layerKind(i.kind)===kind);sheet(kind?(mapKinds.find(x=>x[0]===kind)?.[1]??'지도 정보')+' 목록':'월계1동 지도 정보','<p class="facility-list-note">'+rows.length+'곳'+(!kind||kind==='STREETLIGHT'?' · 점선은 2018년 보안등 주소':'')+'</p><div class="chips">'+mapKinds.map(([k,label])=>'<button data-action="map-catalog" data-value="'+k+'" class="'+(kind===k?'active':'')+'">'+label+'</button>').join('')+'</div>'+(rows.length?rows.map(i=>'<button class="facility-list-row" data-action="map-item-detail" data-value="'+esc(i.id)+'"><span class="symbol-art">'+markerStyle(i.kind).icon+'</span><span><b>'+esc(i.name||i.title||markerStyle(i.kind).label)+'</b><small>'+markerStyle(i.kind).label+(i.locationKind==='ADDRESS'?' · 2018년 주소':i.access==='INDOOR'?' · 실내':'')+'</small></span></button>').join(''):'<p class="empty">확보한 위치 자료가 없습니다.<br>실제 시설이 없다는 뜻은 아니에요.</p>'));}

function placeDetail(place:Place){selectedPlace=place;rememberPlace(place);sheet(place.name,'<span class="place-category">'+esc(place.address||'월계동 보행망 등록 장소')+'</span><h2 class="place-name">'+esc(place.name)+'</h2><p class="small">'+esc(place.address||'장소를 선택해 출발지와 도착지를 정해보세요.')+'</p><div class="place-actions"><button data-action="place-endpoint" data-value="origin">출발</button><button data-action="place-endpoint" data-value="destination">도착</button><button data-action="place-save" aria-pressed="'+savedPlaces().some(p=>p.id===place.id)+'">'+'<img src="'+asset('66-2115','imgButton')+'" alt="">'+'저장</button><button data-action="place-share">'+icon('66-1300',1)+'공유</button></div><div id="place-mini-map" class="mini-map"></div>','place-detail');renderMiniMap('place-mini-map',place.position);}
async function choosePlace(place:Place,side=searchSide){rememberPlace(place);setEndpoint(place,side);showPlanner();}
function setEndpoint(node:Node,side:string){if(side==='origin')state.origin=node;else if(side==='via')viaNodes.push(node);else if(side.startsWith('via-'))viaNodes[Number(side.slice(4))]=node;else state.destination=node;}
async function showSafety(){
  close();if(state.tab!=='map')await showTab('map');
  if(state.routeOpen){await stopGuidance(false);state.routeOpen=false;renderRoute();draw();}
  const generation=++nearbyGeneration;
  $('#layer-menu').hidden=true;$('#nearby-panel').hidden=false;$('#map-page').classList.add('nearby-open');
  nearbyStatus='loading';nearbyError='';renderNearby();
  try{
    const position=freshPosition()?state.position!:await gps();
    if(generation!==nearbyGeneration)return;
    if(!state.coverage)state.coverage=await api.call<Coverage>('/map/coverage');
    if(!itemsLoaded)await refreshItems();
    if(generation!==nearbyGeneration)return;
    nearbyStatus=itemsLoaded?'ready':'data-error';renderNearby();map?.focusUser(position);await startMapWatch();
  }catch(error){
    if(generation!==nearbyGeneration)return;
    nearbyStatus=freshPosition()?'data-error':'unavailable';
    nearbyError=!preferences.location?'내 정보에서 위치 사용을 켜주세요.':(error as {code?:number}).code===1?'위치 권한을 허용하고 다시 시도해주세요.':'GPS 신호를 확인하고 다시 시도해주세요.';
    renderNearby();
  }
}
function nearbyFacilities(kind:string){
  if(!freshPosition()||!state.coverage||!withinCoverage(state.position!,state.coverage)){void showSafety();return;}
  const center=state.position!,rows=nearbyItems(state.items,center,kind);
  sheet('주변 '+(mapKinds.find(k=>k[0]===kind)?.[1]??'시설'),'<p class="facility-list-note">내 위치 주변 '+nearbyRadius+'m · '+rows.length+'곳</p>'+(rows.length?rows.map(item=>'<button class="facility-list-row" data-action="map-item-detail" data-value="'+esc(item.id)+'"><span class="symbol-art">'+markerStyle(item.kind).icon+'</span><span><b>'+esc(item.name||item.title||markerStyle(item.kind).label)+'</b><small>직선 '+Math.round(distanceM(center,item.position))+'m</small></span></button>').join(''):'<p class="empty">주변에 등록된 정보가 없어요.</p>'));
}


function current(){return state.routes[state.index];}
function nodeName(node:Node|null){return node?node.name.startsWith('지도 연결점')?'선택한 연결점':node.name:'지도에서 선택';}
function search():Search {if(!resolvedSearch)throw new Error('경로를 먼저 계산해주세요.');return resolvedSearch;}
function routeMapItems(){
  const items=visibleItems(state.items,layers),r=current();if(!state.routeOpen||!r)return items;
  const relevant=state.night?new Set(['STREETLIGHT','CCTV','EMERGENCY_BELL','CONSTRUCTION','CONSTRUCTION_NOTICE','STAIRS','SLOPE']):state.comfort||state.profile!=='WALK'?new Set(['STAIRS','SLOPE','ELEVATOR','CONSTRUCTION','CONSTRUCTION_NOTICE','EMERGENCY_BELL']):new Set(mapKinds.map(k=>k[0] as string).concat('CONSTRUCTION_NOTICE'));
  return items.filter(i=>i.locationKind!=='ADDRESS'&&relevant.has(i.kind)&&(routeProgress(r.geometry.coordinates,i.position,0)?.offRouteM??Infinity)<=80);
}
function draw(){map?.draw(current(),(demoMode?([...(state.night?presentationFacilities:[]),...(state.demoConstruction?[presentationConstruction]:[])]):[...(preferences.safety?routeMapItems():[]),...(preferences.saved?savedPlaces().map(p=>({...p,kind:'SAVED_PLACE'})):[])]),state.connections[0]?.position??state.origin?.position,state.connections.at(-1)?.position??state.destination?.position,item=>void (item.members?itemDetail(item):demoMode&&item.kind==='CONSTRUCTION'?constructions():demoMode?sheet(item.kind==='EMERGENCY_BELL'?'안심벨':'가로등','<p class="notice">시연 경로에 설정한 시설입니다. 밝은 길과 도움을 요청할 수 있는 시설을 함께 고려합니다.</p>'):item.kind==='SAVED_PLACE'?placeDetail(savedPlaces().find(p=>p.id===item.id)!):item.kind==='CONSTRUCTION_NOTICE'?noticeDetail(item.id):itemDetail(item)),state.night);}
let constructionRoutingNotice='';
let resolvedSearch:Search|undefined;
function renderRoute(){
  if(state.routeOpen){closeNearby();void stopMapWatch();}
  document.body.classList.toggle('route-screen',state.routeOpen);
  document.body.classList.toggle('navigation-screen',state.guiding);
  document.body.classList.toggle('night-mode',state.night);
  $('#route-card').hidden=!state.routeOpen;$('#route-top').hidden=!state.routeOpen;
  $('#map-page').classList.toggle('routing',state.routeOpen);$('#map-page').classList.toggle('guiding',state.guiding);
  $('#night').textContent=(state.night?'☾ 안심귀갓길':'☀ 낮길')+(state.nightAuto?' · 자동':' · 수동');
  $('#route-top').innerHTML=routeHeader(state);$('#layer-menu').hidden=true;$('#route-card').innerHTML=routePanel(state,previewing,constructionRoutingNotice);
}

async function calculate(){
  if(demoMode){await stopGuidance(false);state.error='';state.origin=demoOrigin;state.destination=demoDestination;state.routes=[presentationRoute(state.profile,state.stairs||state.slopes||state.comfort,state.night,state.demoConstruction)];state.index=0;state.busy=false;constructionRoutingNotice='';renderRoute();draw();map?.fit(current());return;}
  if(!state.origin||!state.destination){renderRoute();draw();return;}
  await stopGuidance(false);const id=++routeGeneration;state.busy=true;state.routes=[];state.connections=[];resolvedSearch=undefined;state.excludedConstruction=0;constructionRoutingNotice='';state.error='';renderRoute();draw();
  try{const result=await api.call<Routes>('/routes/plan','POST',{...routeConditions(state),origin:state.origin.position,destination:state.destination.position,via:viaNodes.map(n=>n.position)});if(id!==routeGeneration)return;state.routes=result.routes;state.connections=result.connections??[];resolvedSearch=result.resolvedSearch;constructionRoutingNotice=result.constructionAvoidance?.notice??'';state.index=Math.max(0,result.routes.findIndex(r=>r.labels.includes(state.night?'NIGHT':state.comfort?'COMFORT':'FAST')));state.version=result.graphVersion;state.excludedConstruction=result.excludedEdges?.construction??0;if(result.status!=='OK')state.error=result.notice||'조건에 맞는 경로가 없습니다. 출발·도착과 이동 조건을 바꿔주세요.';draw();}
  catch(e){if(id===routeGeneration)state.error=(e as Error).message;}
  finally{if(id===routeGeneration){state.busy=false;renderRoute();map?.fit(current());}}
}
let publicConstructions:ConstructionCatalog|undefined;
async function allMapItems(){const items:MapItem[]=[];let offset:number|null=0;for(let page=0;offset!==null&&page<40;page++){const r: {items:MapItem[];nextOffset?:number|null}=await api.call('/map/items?offset='+offset+'&limit=500');items.push(...r.items);const next=r.nextOffset??null;if(next!==null&&next<=offset)throw new Error('지도 데이터 페이지 오류');offset=next;}if(offset!==null)throw new Error('지도 정보가 너무 많아 전체를 불러오지 못했습니다.');return {items};}
async function refreshItems(){
  const [mapResult,noticeResult]=await Promise.allSettled([allMapItems(),api.call<ConstructionCatalog>('/construction-notices')]);
  if(mapResult.status==='rejected'){itemsLoaded=false;nearbyStatus='data-error';renderNearby();throw mapResult.reason;}
  state.items=mapResult.value.items;publicConstructions=noticeResult.status==='fulfilled'?noticeResult.value:undefined;
  for(const n of publicConstructions?.items??[])if(n.position&&n.period!=='PAST_PERIOD')state.items.push({id:n.id,kind:'CONSTRUCTION_NOTICE',title:n.title,position:n.position});
  const badge=document.querySelector('.construction-home span');if(badge)badge.textContent=publicConstructions?.available?`공공자료 ${publicConstructions.items.filter(n=>n.period==='IN_PERIOD').length}건`:'통제·우회 확인';
  itemsLoaded=!!publicConstructions?.available;nearbyStatus=itemsLoaded&&freshPosition()?'ready':'data-error';renderNearby();draw();
}
async function showTab(tab:string){
  document.body.dataset.tab=tab;close();closeNearby();if(tab!=='map'){await stopMapWatch();await stopGuidance();}state.tab=tab;$('#map-page').hidden=tab!=='map';$('#page').hidden=tab==='map';document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',(b as HTMLElement).dataset.value===tab));
  document.querySelectorAll<HTMLImageElement>('nav img').forEach(img=>{const target=img.closest<HTMLElement>('button')!.dataset.value;const active=target===tab;img.src=target==='map'?asset(active?'66-2':'66-1005',active?'imgIcon11':'imgIcon10'):target==='reports'?asset(active?'66-1151':'66-1005',active?'imgText':'imgIcon9'):asset(active?'66-1005':'66-2',active?'imgText':'imgIcon12');});
  if(tab==='map'){draw();return;}$('#page').innerHTML='<p class="small">불러오는 중…</p>';
  try{if(tab==='reports')await reports();else if(tab==='saved')await saved();else await profile();}catch(e){$('#page').innerHTML=`<p class="error">${esc((e as Error).message)}</p><button class="secondary" data-action="tab" data-value="${esc(tab)}">다시 불러오기</button>`;}
}
async function nearby(p:Position,side:string,placeName=''){setEndpoint({id:'map-'+p.lat.toFixed(6)+'-'+p.lng.toFixed(6),name:placeName||'지도에서 선택한 위치',position:p},side);showPlanner();}
function pick(side:string){planning=true;if(demoMode){toast('시연 화면에서는 고정 경로를 사용합니다. 일반 지도로 돌아가 장소를 선택해주세요.');return;}openSearch(side);}
function pickPosition(p:Position){
  state.selected=p;
  if(mapPicking==='report'){mapPicking='';$('#map-pick-hint').hidden=true;newReport();return;}
  if(mapPicking){const side=mapPicking;mapPicking='';$('#map-pick-hint').hidden=true;void nearby(p,side).catch(e=>toast(e.message));return;}
  sheet('이 위치에서','<p class="small">'+p.lat.toFixed(5)+', '+p.lng.toFixed(5)+'</p><button class="secondary" data-action="near-node" data-value="origin">출발지로 선택</button><button class="secondary" data-action="near-node" data-value="destination">도착지로 선택</button><button class="primary" data-action="report-new">이 위치 제보하기</button>');
}
function settings(){sheet('카카오 지도 · 서버 연결',`<form data-form="settings"><p class="notice">카카오 지도 등록 도메인: <b>${esc(location.origin)}</b><br>카카오 개발자 앱에 이 도메인을 등록하세요. REST API 키는 서버 .env에만 넣습니다.</p><label for="api-url">백엔드 주소</label><input id="api-url" name="apiUrl" value="${esc(api.settings.apiUrl)}" placeholder="비워두면 현재 앱 주소 사용"><label for="kakao-key">카카오 JavaScript 키</label><input id="kakao-key" name="kakaoKey" value="${esc(api.settings.kakaoKey)}" autocomplete="off" spellcheck="false" maxlength="32"><p class="small">키와 서버 주소는 기기에 저장됩니다. 저장 후 앱 화면을 다시 불러옵니다. 휴대폰에서는 HTTPS 배포 주소를 사용하세요.</p><div class="form-error" role="alert"></div><button class="primary" type="submit">설정 저장 · 다시 연결</button></form>`);}
function options(){if(demoMode){sheet('시연 이동 조건',`<p class="notice">계단·언덕을 돌아가는 경로를 비교해보세요.</p><button class="secondary" data-action="demo-profile" data-value="WALK">일반 보행 · 지름길</button><button class="secondary" data-action="demo-profile" data-value="WHEELCHAIR">휠체어 · 계단·언덕 회피</button><button class="secondary" data-action="demo-profile" data-value="STROLLER">유모차 · 계단·언덕 회피</button>`);return;}sheet('이동 조건',`<form data-form="options"><label for="profile">이동 방식</label><select id="profile" name="profile">${[['WALK','일반 보행'],['WHEELCHAIR','휠체어'],['STROLLER','유모차']].map(([v,n])=>`<option value="${v}" ${state.profile===v?'selected':''}>${n}</option>`).join('')}</select><label><input name="stairs" type="checkbox" ${state.stairs?'checked':''}> 계단 피하기</label><label><input name="slopes" type="checkbox" ${state.slopes?'checked':''}> 알려진 급경사 피하기 (6% 초과 제외)</label><label><input name="verifiedOnly" type="checkbox" ${state.verifiedOnly?'checked':''}> 현장 확인된 구간만 찾기</label><p class="small">체크하면 미확인 구간을 제외합니다.</p><button class="primary">다시 찾기</button></form>`);}
function login(signup=false){sheet(signup?'월계동 주민 회원가입':'주민 로그인',`<div class="auth-welcome"><img src="/figma/route-cat.png" alt="총총 고양이"><h2>${signup?'반가워요, 월계동 이웃님':'다시 만나 반가워요'}</h2><p>${signup?'함께 만드는 편안한 우리 동네 길':'저장한 길과 이웃의 소식을 만나보세요'}</p></div><form data-form="${signup?'signup':'login'}">${signup?'<label for="nickname">닉네임</label><input id="nickname" name="nickname" required maxlength="30" autocomplete="nickname"><label for="district">우리 동네 · 생활권</label><select id="district" name="district"><option>월계1동</option><option>월계2동</option><option>월계3동</option><option>월계동 생활권</option></select>':''}<label for="email">이메일</label><input id="email" name="email" type="email" maxlength="254" autocomplete="email" required><label for="password">비밀번호</label><input id="password" name="password" type="password" minlength="10" maxlength="128" autocomplete="${signup?'new-password':'current-password'}" required placeholder="10자 이상">${signup?'<label for="password-confirm">비밀번호 확인</label><input id="password-confirm" name="passwordConfirm" type="password" minlength="10" maxlength="128" autocomplete="new-password" required><p class="small">생활권은 직접 선택하는 정보이며 거주지 인증은 아닙니다. 상세 주소는 받지 않습니다.</p>':''}<div class="form-error" role="alert"></div><button class="primary" type="submit">${signup?'회원가입':'로그인'}</button></form><button class="secondary auth-switch" data-action="${signup?'login':'signup'}">${signup?'이미 가입했어요 · 로그인':'처음 오셨나요? 회원가입'}</button>`);}
function requireUser(){if(state.user)return true;login();return false;}
async function reports(append=false){
  const offset=append?state.nextOffset:0;if(offset===null)return;
  const [result,summary]=await Promise.all([api.call<{items:Report[];nextOffset:number|null}>('/reports?limit=20&offset='+offset+(state.filter?'&type='+state.filter:'')),api.call<{verified:number;pending:number}>('/reports/summary')]);
  state.reports=append?[...state.reports,...result.items]:result.items;state.nextOffset=result.nextOffset;
  $('#page').innerHTML=reportList(state.reports,state.filter,state.nextOffset,summary);
}
function newReport(){captureDraft();if(filmMode&&!state.selected)state.selected=demoOrigin.position;sheet('제보 작성',reportForm(state.selected,reportDraft));renderMiniMap('report-location-map',state.selected);}
async function reportDetail(id:string){
  const [r,confirmed]=await Promise.all([api.call<Report>('/reports/'+id),state.user?api.call<Report[]>('/me/confirmations'):Promise.resolve([])]);
  const active=confirmed.some(x=>x.id===id);
  sheet('제보 상세','<article class="report-detail"><span class="tag">'+types[r.type]+'</span><h2>'+esc(r.title)+'</h2><div class="report-author"><span class="author-avatar">'+icon('66-1005',9)+'</span><span><b>월계동 이웃</b><small>'+timeAgo(r.createdAt)+' · '+statuses[r.status]+'</small></span><button data-action="report-share" data-value="'+esc(id)+'" aria-label="제보 공유">'+icon('66-1300',1)+'</button></div><div class="report-photos">'+(r.photos?.length?r.photos.map(p=>'<img src="'+esc(p)+'" alt="제보 현장 사진">').join(''):'<div class="no-photo">'+icon('66-1300',2)+'<span>첨부한 현장 사진이 없어요</span></div>')+'</div><section class="form-card"><h3>제보 내용</h3><p class="detail">'+esc(r.description)+'</p></section><button class="report-map-preview" data-action="report-map" data-lat="'+r.position.lat+'" data-lng="'+r.position.lng+'"><div id="detail-mini-map" class="mini-map"></div><span>'+icon('66-1300',7)+'월계동 · 지도에서 위치 확인</span></button><section class="empathy-bar">'+icon('66-1300',8)+'<span><b>공감 '+r.confirmationCount+'명</b><small>같은 불편을 겪고 있어요</small></span><button data-action="'+(active?'unconfirm':'confirm')+'" data-value="'+esc(id)+'" aria-pressed="'+active+'">'+icon('66-1300',9)+(active?'공감했어요':'공감하기')+'</button></section><button class="flag-report" data-action="flag-report" data-value="'+esc(id)+'">'+icon('66-1300',10)+'부적절한 제보 신고</button></article>');renderMiniMap('detail-mini-map',r.position);
}
async function saved(){if(!state.user){$('#page').innerHTML='<h2>저장한 길</h2><p class="empty">로그인하고 자주 걷는 길을 저장하세요.</p><button class="primary" data-action="login">로그인</button>';return;}state.saved=await api.call<Saved[]>('/me/routes');$('#page').innerHTML=`<h2>저장한 길</h2><p class="small">열 때마다 최신 공사 정보를 반영해 다시 계산합니다.</p>${state.saved.length?state.saved.map(r=>`<div class="card"><strong>${esc(r.name)}</strong><div class="row"><button class="secondary" data-action="saved-open" data-value="${esc(r.id)}">길 찾기</button><button class="secondary" data-action="saved-delete" data-value="${esc(r.id)}">삭제</button></div></div>`).join(''):'<p class="empty">아직 저장한 길이 없어요.</p>'}`;}
async function profile(){const counts={reports:0,confirmations:0};if(state.user){const [mine,confirmed]=await Promise.all([api.call<Report[]>('/me/reports'),api.call<Report[]>('/me/confirmations')]);counts.reports=mine.length;counts.confirmations=confirmed.length;}$('#page').innerHTML=profileView(state.user,counts);}
let constructionRows:Construction[]=[];
const dateText=(v?:string)=>v?new Date(v).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}):'미정';
async function constructions(){
  if(demoMode){sheet('공사·통제 안내',`<p class="demo-note">실제 도로 위 통제 상황 재현</p><div class="card"><span class="tag">보행 통제</span><h2>보행로 정비 공사</h2><p>이동하려던 길 일부가 공사 중이에요.<br>통제 구간을 피해 다른 길로 안내합니다.</p><p class="notice">등록 계단을 피하는 조건을 유지하며 우회해요.</p></div><button class="primary" data-action="demo-construction">공사 구간 피해 다시 찾기</button>`);return;}

  sheet('월계동 공사 안내','<p class="notice">최신 등록 정보를 불러오는 중…</p>');
  try{publicConstructions=await api.call<ConstructionCatalog>('/construction-notices');}catch{publicConstructions=undefined;}
  try{constructionRows=await api.call<Construction[]>('/constructions');}catch(e){sheet('월계1동 공사 안내',`<p class="error">${esc((e as Error).message)}</p><button class="primary" data-action="constructions">다시 불러오기</button>`);return;}
  const live=constructionRows.filter(c=>c.status==='ACTIVE'),resolved=constructionRows.filter(c=>c.status==='RESOLVED');
  const card=(c:Construction)=>`<button class="card construction-card" data-action="construction-detail" data-value="${esc(c.id)}"><span class="tag ${c.impact==='BLOCK'?'blocked':''}">${constructionStatus(c)}</span>${c.needsRecheck?'<span class="tag">재확인 필요</span>':''}<strong>${esc(c.title)}</strong><p>${esc(c.description)}</p><small>시작 ${esc(dateText(c.startsAt))} · 종료 예정 ${esc(dateText(c.expectedEndAt))}</small></button>`;
  sheet('월계동 공사 안내',`${publicNoticeList()}<h2>확인된 보행 통제 ${live.length}건</h2>${live.length?live.map(card).join(''):'<p class="notice">보행 통제 구간은 아직 확인되지 않았습니다. 위 공사 현황이 자동으로 통행 금지를 뜻하지는 않습니다.</p>'}<button class="primary" data-action="construction-replan">확인된 통제를 반영해 길찾기</button><button class="secondary" data-action="construction-report">주민 공사 제보 보기</button><button class="secondary" data-action="report-new">현장에서 본 공사 제보하기</button>${resolved.length?'<details><summary>통제 해제 '+resolved.length+'건</summary>'+resolved.map(card).join('')+'</details>':''}`);
}
const noticeRegion=(n:ConstructionNotice)=>n.region==='WOLGYE1'?(n.locationKind==='PROJECT_POINT'?'월계1동 사업 대표 위치':'월계1동 주소 기준점'):n.region==='OTHER_WOLGYE'?'월계1동 경계 밖 주소':'월계동 · 행정동 미확인';
function publicNoticeList(){
  const c=publicConstructions;if(!c?.available)return '<p class="error">서울시 공사 자료를 불러오지 못했습니다. 공사가 없다는 뜻은 아닙니다.</p>';
  const active=c.items.filter(n=>n.period!=='PAST_PERIOD').sort((a,b)=>Number(b.region==='WOLGYE1')-Number(a.region==='WOLGYE1')),past=c.items.filter(n=>n.period==='PAST_PERIOD');
  const card=(n:ConstructionNotice)=>`<button class="card construction-card" data-action="notice-detail" data-value="${esc(n.id)}"><span class="tag">${n.period==='IN_PERIOD'?'등록 공사기간 내':n.period==='UPCOMING'?'예정':'등록기간 경과 · 완료 미확인'}</span><small>${noticeRegion(n)}</small><strong>${esc(n.title)}</strong><p>${esc(n.startsOn)} ~ ${esc(n.endsOn)}</p><small>${esc(n.administrativeStatus)} · ${n.position?(n.locationKind==='PROJECT_POINT'?'사업 대표 위치':'주소 기준점'):'위치 미확인'}</small></button>`;
  return `<p class="notice">서울시 도로굴착·건설알림이 자료예요.</p><p class="small">수집 ${esc(dateText(c.collectedAt??undefined))} · 서울특별시 / 공공누리 제1유형</p>${c.stale?'<p class="notice warn">수집 후 48시간이 지난 자료입니다. 최신 상태를 다시 확인해주세요.</p>':''}<h2>등록기간 내·예정 공사 ${active.length}건</h2>${active.length?active.map(card).join(''):'<p class="notice">등록기간 내 공사 자료가 없습니다. 주변 모든 공사의 부재를 뜻하지 않습니다.</p>'}<details><summary>이전 공사 기록 ${past.length}건 · 완료 여부 미확인</summary>${past.map(card).join('')}</details>`;
}
async function noticeDetail(id:string){
  if(!publicConstructions)publicConstructions=await api.call<ConstructionCatalog>('/construction-notices');
  const n=publicConstructions.items.find(n=>n.id===id);if(!n)throw new Error('공사 목록을 다시 불러와주세요.');
  sheet('공사 안내',constructionNoticeView(n,publicConstructions),'facility-sheet');
}
async function constructionDetail(id:string){
  constructionRows=await api.call<Construction[]>('/constructions');const c=constructionRows.find(c=>c.id===id);if(!c)throw new Error('공사 정보를 다시 불러와주세요.');
  sheet('공사 안내',constructionView(c,constructionStatus(c)),'facility-sheet');
}
async function itemDetail(i:MapItem){if(i.members){sheet('주변 지도 정보','<p class="small">시설을 선택해주세요.</p>'+i.members.map(m=>'<button class="facility-list-row" data-action="map-item-detail" data-value="'+esc(m.id)+'"><span class="symbol-art">'+markerStyle(m.kind).icon+'</span><span><b>'+esc(m.name||m.title||markerStyle(m.kind).label)+'</b><small>'+markerStyle(m.kind).label+'</small></span></button>').join(''));return;}if(i.kind==='CONSTRUCTION'){await constructionDetail(i.id);return;}if(i.kind==='REPORT'){await reportDetail(i.id);return;}sheet(markerStyle(i.kind).label+' 정보',facilityView(i),'facility-sheet');}

async function gps(){
  if(!preferences.location)throw new Error('내 정보에서 위치 사용을 켜주세요. 지도에서 직접 선택할 수도 있어요.');
  if(Capacitor.isNativePlatform()){const result=await Geolocation.requestPermissions({permissions:['location']});if(result.location!=='granted'&&result.coarseLocation!=='granted')throw new Error('위치 권한을 허용해주세요. 지도 선택은 권한 없이도 가능합니다.');}
  const p=await Geolocation.getCurrentPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0});
  if(!preferences.location)throw new Error('위치 사용이 꺼져 있어요.');
  if(!usableFix(p.coords.accuracy,p.timestamp))throw new Error('위치가 오래됐거나 정확도가 낮습니다. 야외에서 다시 시도하거나 지도에서 선택해주세요.');
  acceptPosition({lat:p.coords.latitude,lng:p.coords.longitude},p.timestamp,p.coords.accuracy,true);return state.position!;
}
async function stopGuidance(render=true){
  ++watchGeneration;state.guiding=false;map?.clearGuide();if(previewTimer)clearInterval(previewTimer);previewTimer=undefined;if(previewing){map?.clearPosition();if(state.position)map?.position(state.position,true,freshPosition()?'내 위치':'위치 갱신 필요');}previewing=false;if(refreshTimer)clearInterval(refreshTimer);refreshTimer=undefined;const id=watch;watch=undefined;if(id)await Geolocation.clearWatch({id});if(render){renderRoute();$('#route-card').scrollTop=0;map?.fit(current());}
}
async function startGuidance(){
  if(demoMode){await previewRoute();return;}
  if(!navigator.onLine)throw new Error('인터넷 연결 후 안내를 시작해주세요.');if(!current())return;close();await stopGuidance(false);const generation=++watchGeneration;const p=await gps();
  if(generation!==watchGeneration||document.hidden)return;
  await api.call(`/coverage/nearby?lat=${p.lat}&lng=${p.lng}&radiusM=500`);
  if(!state.origin||distanceM(p,{lng:current()!.geometry.coordinates[0][0],lat:current()!.geometry.coordinates[0][1]})>100)throw new Error('선택한 출발지에서 100m 이상 떨어져 있습니다. 출발지를 현재 위치 주변 연결점으로 다시 선택해주세요.');
  const latest=await api.call<{graphVersion:string}>('/routes/version');
  if(generation!==watchGeneration||document.hidden)return;
  if(latest.graphVersion!==state.version){await refreshItems();await calculate();toast('통행 정보가 바뀌었습니다. 새 경로를 확인한 뒤 출발해주세요.');return;}
  state.guiding=true;recent.length=0;renderRoute();$('#route-card').scrollTop=0;lastFix=Date.now();map?.focusPoint(p);updateGuidance(p);
  const id=await Geolocation.watchPosition({enableHighAccuracy:true,timeout:15000,maximumAge:0,minimumUpdateInterval:1000},(pos,error)=>{
    if(generation!==watchGeneration||!state.guiding)return;
    if(error||!pos){void stopGuidance();toast('위치를 받지 못해 안내를 중지했습니다. GPS와 권한을 확인하세요.');return;}
    if(!usableFix(pos.coords.accuracy,pos.timestamp)){map?.clearGuide();$('#guide-message').textContent='위치 정확도를 확인하고 있어요';return;}
    lastFix=Date.now();const position={lat:pos.coords.latitude,lng:pos.coords.longitude};acceptPosition(position,pos.timestamp,pos.coords.accuracy,true);updateGuidance(position);
    if(!state.guiding||!state.night||!preferences.notifications||Date.now()-lastFacilityCheck<5000||checking)return;lastFacilityCheck=Date.now();checking=true;
    void api.call<{state:string;alerts:Array<{facilityId:string;alertedAt:string;message:string}>;warnings:Array<{message:string}>}>('/night/check','POST',{position,accuracyM:pos.coords.accuracy,measuredAt:new Date(pos.timestamp).toISOString(),recentAlerts:recent.slice(-90)}).then(result=>{
      if(generation!==watchGeneration)return;const text=result.state==='PAUSED'?'위치 정확도가 낮아 안내를 잠시 멈췄어요.':result.alerts[0]?.message||result.warnings[0]?.message||'등록된 조명 정보가 없는 구간입니다. 주변을 확인하세요.';
      if($('#facility-message'))$('#facility-message').textContent=text;
      
      recent.push(...result.alerts.map(a=>({facilityId:a.facilityId,alertedAt:a.alertedAt})));if(recent.length>100)recent.splice(0,recent.length-100);
    }).catch(e=>{if(generation===watchGeneration){void stopGuidance();toast(e.message);}}).finally(()=>checking=false);
  });
  if(generation!==watchGeneration){await Geolocation.clearWatch({id});return;}watch=id;
  refreshTimer=setInterval(()=>{void api.call<{graphVersion:string}>('/routes/version').then(async v=>{if(generation!==watchGeneration)return;if(v.graphVersion!==state.version){await stopGuidance();await refreshItems();await calculate();toast('공사·통행 정보가 변경되어 다시 찾았습니다. 새 경로를 확인한 뒤 출발해주세요.');}else if(Date.now()-lastFix>30000){await stopGuidance();toast('위치 신호가 끊겨 안내를 중지했습니다.');}}).catch(e=>{void stopGuidance();toast(e.message);});},15000);
}
function help(){sheet('안심 도움',`<p class="notice">긴급 상황에서는 주변 도움을 요청하세요.</p><a class="primary" href="tel:112">112 전화 앱 열기</a><button class="secondary" data-action="facilities">현재 위치 주변 시설 찾기</button><button class="secondary" data-action="report-new">위험한 구간 제보</button><p class="small">자동 신고나 위치 전송은 하지 않습니다.</p>`);}
async function action(b:HTMLElement){const a=b.dataset.action,v=b.dataset.value!;
  if(await wireframeAction(a||'',v,b))return;
  if(a==='demo-construction'){close();state.demoConstruction=true;await calculate();toast('공사 구간을 피해 경로를 다시 찾았어요.');return;}
  if(a==='demo-enter'){location.assign('?demo=1');return;}
  if(a==='demo-exit'){location.assign(location.pathname);return;}
  if(a==='demo-profile'){close();state.profile=v as Search['profile'];state.stairs=state.profile!=='WALK';state.slopes=state.stairs;state.comfort=state.stairs;await calculate();return;}
  if(a==='save'&&demoMode&&!filmMode){toast('시연 경로는 실제 경로 목록에 저장하지 않습니다.');return;}
  if(a==='start'&&demoMode){await previewRoute();return;}
  if(a==='transport'){state.nightAuto=false;state.transport=v==='ALL'?'ALL':'WALK';state.profile=(v==='ALL'?'WALK':v) as Search['profile'];if(state.profile!=='WALK'){state.night=false;state.comfort=true;state.stairs=true;state.slopes=true;state.verifiedOnly=true;}else{selectPreference(state,'FAST');state.verifiedOnly=false;}await calculate();}
  else if(a==='transit-info'){state.transport='TRANSIT';renderRoute();}
  else if(a==='route-preference'){state.transport='WALK';selectPreference(state,v as 'FAST'|'COMFORT'|'NIGHT');state.verifiedOnly=false;state.nightAuto=false;await calculate();}
  else if(a==='replan-current'){const position=state.position&&Date.now()-state.positionAt<30000?state.position:await gps();state.origin={id:'current-position',name:'현재 위치',position};await calculate();toast('현재 위치에서 다시 찾았어요. 경로를 확인하고 안내를 시작해주세요.');}
  else if(a==='data-policy'){state.verifiedOnly=v==='VERIFIED';await calculate();}
  else if(a==='constructions')await constructions();
  else if(a==='construction-detail')await constructionDetail(v);
  else if(a==='construction-map'){const c=constructionRows.find(c=>c.id===v);if(c){await stopGuidance(false);state.routeOpen=false;renderRoute();layers.add('CONSTRUCTION');await showTab('map');await refreshItems();map?.focusConstruction(c);}}
  else if(a==='notice-detail'){await noticeDetail(v);}
  else if(a==='notice-map'){const n=publicConstructions?.items.find(n=>n.id===v);if(n?.position){close();await stopGuidance(false);state.routeOpen=false;renderRoute();layers.add('CONSTRUCTION');await showTab('map');await refreshItems();map?.focusPoint(n.position);toast(n.locationKind==='PROJECT_POINT'?'공사 사업의 대표 위치입니다.':'공사 주소의 기준 위치입니다.');}}
  else if(a==='construction-replan'){close();state.routeOpen=true;await showTab('map');await refreshItems();if(state.origin&&state.destination){await calculate();toast('등록된 최신 통제 정보를 반영해 다시 계산했어요.');}else{renderRoute();pick('origin');}}
  else if(a==='construction-report'){state.filter='CONSTRUCTION';await showTab('reports');}
  else if(a==='install')sheet('홈 화면에 추가', '<p class="notice">'+esc(await installApp())+'</p>');
  else if(a==='route-open'){showPlanner();}
  else if(a==='route-close'){await stopGuidance(false);state.routeOpen=false;renderRoute();draw();}
  else if(a==='layers')layerMenu();
  else if(a==='map-catalog')facilityList(v);
  else if(a==='map-item-detail'){const item=state.items.find(i=>i.id===v);if(item){if(item.kind==='CONSTRUCTION_NOTICE')await noticeDetail(v);else await itemDetail(item);}}
  else if(a==='map-item-focus'){const item=state.items.find(i=>i.id===v);if(item){close();await stopGuidance(false);state.routeOpen=false;renderRoute();preferences.safety=true;writeLocal('preferences',preferences);layers.add(layerKind(item.kind));await showTab('map');draw();map?.focusPoint(item.position);}}
  else if(a==='map-item-route'){const item=state.items.find(i=>i.id===v);if(item){close();setEndpoint({id:item.id,name:item.name||item.title||markerStyle(item.kind).label,position:item.position},'destination');showPlanner();}}
  else if(a==='news')await showSafety();
  else if(a==='nearby-close')closeNearby();
  else if(a==='nearby-facilities')nearbyFacilities(v);
  else if(a==='nearby-route'){const position=freshPosition()?state.position!:await gps();state.origin={id:'current-position',name:'현재 위치',position};selectPreference(state,'NIGHT');state.verifiedOnly=false;state.nightAuto=false;showPlanner();}
  else if(a==='close'){captureDraft();if(planning&&$('#sheet-title').textContent==='장소 검색')showPlanner();else{planning=false;close();}}else if(a==='tab')await showTab(v);else if(a==='settings')settings();else if(a==='login')login();else if(a==='signup')login(true);
  else if(a==='logout'){if(auth)await auth.auth.signOut({scope:'local'});else if(api.token){try{await api.call('/auth/logout','POST');}catch(e){if(!(e instanceof ApiError&&e.status===401))toast('기기에서 로그아웃했어요. 서버 세션은 만료 시 종료됩니다.');}}api.token='';state.user=null;state.saved=[];await showTab('profile');}
  else if(a==='night'){sheet('안심귀갓길',`<p class="notice">월계1동 일몰부터 다음 일출까지 자동으로 켜집니다. 밤에는 등록된 조명 정보를 우선해 경로를 찾습니다.</p><button class="secondary" data-action="night-mode" data-value="auto">일몰·일출 자동 전환</button><button class="secondary" data-action="night-mode" data-value="night">${demoMode?'시연 시간: 밤':'야간 안심귀갓길'}</button><button class="secondary" data-action="night-mode" data-value="day">${demoMode?'시연 시간: 낮':'일반 길안내'}</button>`);}else if(a==='night-mode'){state.nightAuto=v==='auto';state.night=state.nightAuto?daylight().night:v==='night';close();await calculate();}else if(a==='options')options();
  else if(a==='layer'){layers.has(v)?layers.delete(v):layers.add(v);if(layers.has(v)){preferences.safety=true;writeLocal('preferences',preferences);}b.classList.toggle('active',layers.has(v));b.setAttribute('aria-pressed',String(layers.has(v)));draw();layerMenu(true);if(layers.has(v)&&!state.items.some(i=>layerKind(i.kind)===v))toast('현재 확보한 위치 자료가 없습니다. 실제 시설의 부재를 뜻하지 않아요.');}
  else if(a==='fit')map?.fit(current());else if(a==='zoom')map?.zoom();else if(a==='locate'){await showSafety();}
  else if(a==='pick')pick(v as 'origin'|'destination');
  else if(a==='set-node'){const n=state.coverage?.nodes.find(n=>n.id===v);if(!n)throw new Error('선택한 연결점이 없습니다.');setEndpoint(b.dataset.placeName?{...n,name:b.dataset.placeName+' 인근'}:n,b.dataset.side||'destination');showPlanner();}
  else if(a==='near-node'&&state.selected)await nearby(state.selected,v as 'origin'|'destination');
  else if(a==='gps-origin'){await nearby(await gps(),'origin');}else if(a==='gps-report'){state.selected=await gps();newReport();}
  else if(a==='route'){await stopGuidance(false);state.index=Number(v);renderRoute();draw();map?.fit(current());}
  else if(a==='save'){if(!current()||!requireUser())return;sheet('자주 걷는 길 저장','<form data-form="save"><label for="save-name">이름</label><input id="save-name" name="name" value="나의 월계 밤길" required maxlength="80"><div class="form-error" role="alert"></div><button class="primary">저장하기</button></form>');}
  else if(a==='saved-open'){state.routeOpen=true;const r=state.saved.find(r=>r.id===v)!;state.origin=state.coverage?.nodes.find(n=>n.id===r.search.originNodeId)||null;state.destination=state.coverage?.nodes.find(n=>n.id===r.search.destinationNodeId)||null;state.profile=r.search.profile;state.transport='WALK';state.comfort=r.search.preference==='COMFORT';state.verifiedOnly=r.search.dataPolicy!=='REFERENCE';state.night=state.nightAuto?daylight().night:r.search.preference==='NIGHT';state.stairs=r.search.avoidStairs;state.slopes=r.search.avoidSlopes??false;viaNodes=(r.search.viaNodeIds??[]).map(id=>state.coverage?.nodes.find(n=>n.id===id)).filter((n):n is Node=>!!n);state.routes=[];await showTab('map');await calculate();}
  else if(a==='saved-delete'){await api.call('/me/routes/'+v,'DELETE');await saved();}
  else if(a==='report-new')newReport();else if(a==='report-detail')await reportDetail(v);else if(a==='filter'){state.filter=v;await reports();}else if(a==='more-reports')await reports(true);
  else if(a==='confirm'||a==='unconfirm'){if(!requireUser())return;await api.call('/reports/'+v+'/confirmation',a==='confirm'?'PUT':'DELETE');if(state.tab==='reports')await reports();else if(state.tab==='profile')await profile();await reportDetail(v);if(a==='confirm'){const feedback=$<HTMLDialogElement>('#feedback');feedback.innerHTML='<img class="success-mascot" src="'+asset('66-1420','imgImage1','png')+'" alt="공감을 축하하는 핑크 날개말"><div class="success-check">'+icon('66-1679')+'</div><h2>이 제보에 공감했어요!</h2><p>함께 공감할수록 더 빠르게<br>우리 동네가 좋아질 거예요.</p><button class="primary" data-action="feedback-close">확인</button>';feedback.showModal();}}
  else if(a==='report-map'){close();await showTab('map');map?.selectedPosition({lat:Number(b.dataset.lat),lng:Number(b.dataset.lng)},'제보 위치');}
  else if(a==='my-confirmations'){if(!requireUser())return;const rows=await api.call<Report[]>('/me/confirmations');sheet('공감한 글',rows.length?'<div class="report-list">'+rows.map(reportCard).join('')+'</div>':'<p class="empty">현장에서 확인한 제보가 없습니다.</p>');}
  else if(a==='my-reports'){if(!requireUser())return;const rows=await api.call<Report[]>('/me/reports');sheet('내가 쓴 글',rows.length?'<div class="report-list">'+rows.map(reportCard).join('')+'</div>':'<p class="empty">남긴 제보가 없습니다.</p>');}
  else if(a==='sources')sheet('자료 출처와 확인 상태','<p class="notice">카카오 지도: Kakao Maps JavaScript SDK<br>장소 검색: Kakao Local REST API<br>경로 계산: 월계1동 공개 OSM 보행망 1,886개 구간<br>행정경계: 서울시 공개 뷰어 2025-06-30</p><p class="notice warn">가로등 16개: 서울시 파일 등록일 2023-12-22, 현장 확인일 아님.<br>현재 밝기·시설 작동·최신 공사 현황은 미확보입니다. 경로는 카카오가 계산한 보행 경로가 아닙니다.</p><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">© OpenStreetMap contributors</a>');
  else if(a==='start')sheet('동행 안내 시작','<p class="notice">실제 GPS 위치를 사용합니다. 화면을 켜 둔 동안 근처 야간 시설 정보를 확인합니다. 음성 회전 안내·백그라운드 길찾기는 아직 지원하지 않습니다.</p><button class="primary" data-action="gps-start">위치 권한 확인 · 시작</button>');
  else if(a==='preview-route'){await previewRoute();}
  else if(a==='gps-start'){try{await startGuidance();}catch(e){await stopGuidance();throw e;}}else if(a==='stop')await stopGuidance();else if(a==='help')help();
  else if(a==='facilities'){const p=await gps();const rows=await api.call<Array<{name:string;distanceM:number;needsRecheck:boolean}>>(`/facilities/nearby?lat=${p.lat}&lng=${p.lng}&radiusM=500`);sheet('주변 시설',rows.length?rows.map(r=>`<div class="card"><strong>${esc(r.name)}</strong><p>직선 ${r.distanceM}m · 현재 작동 상태 미확인</p></div>`).join(''):'<p class="empty">주변 500m 안에 확보한 시설 자료가 없습니다. 실제 시설이 없다는 의미는 아닙니다.</p>');}
  else if(a==='place'&&filmMode){close();state.routeOpen=true;await showTab('map');await calculate();}
  else if(a==='place'){await nearby({lat:Number(b.dataset.lat),lng:Number(b.dataset.lng)},'destination');}
}
document.addEventListener('click',e=>{const b=(e.target as HTMLElement).closest<HTMLElement>('[data-action]');if(!b)return;b.setAttribute('disabled','');void action(b).catch(e=>{if(e instanceof ApiError&&e.status===401){state.user=null;api.token='';login();}toast(e.message);}).finally(()=>b.removeAttribute('disabled'));});
document.addEventListener('submit',e=>{const form=e.target as HTMLFormElement;e.preventDefault();if(!form.reportValidity())return;if(form.dataset.submitting)return;form.dataset.submitting='true';const button=form.querySelector<HTMLButtonElement>('button[type=submit],button:not([type])');if(button)button.disabled=true;void submit(form).catch(e=>{const error=form.querySelector('.form-error');if(error){error.classList.add('error');error.textContent=e.message;}else toast(e.message);}).finally(()=>{delete form.dataset.submitting;if(button)button.disabled=false;});});
async function submit(form:HTMLFormElement){
  const d=new FormData(form),value=(k:string)=>String(d.get(k)||'');
  if(form.dataset.form==='place-search'){await runSearch(value('query'));}
  else if(form.id==='search-form'){const results=await api.call<{items:Array<{id:string;name:string;address?:string;position:Position}>;notice?:string}>('/places?q='+encodeURIComponent(value('query')));sheet('장소 검색',`${results.notice?`<p class="notice warn">${esc(results.notice)}</p>`:''}${results.items.length?results.items.map(n=>`<button class="choice" data-action="place" data-lat="${n.position.lat}" data-lng="${n.position.lng}">${esc(n.name)}<small>${esc(n.address||'등록된 지도 지점')} · 도착 연결점 찾기</small></button>`).join(''):'<p class="empty">검색 결과가 없습니다.</p>'}`);}
  else if(form.dataset.form==='settings'){await saveSettings({apiUrl:validApiUrl(value('apiUrl')),kakaoKey:validKakaoKey(value('kakaoKey'))});await stopGuidance(false);location.reload();}
  else if(form.dataset.form==='options'){state.profile=value('profile') as Search['profile'];state.verifiedOnly=d.has('verifiedOnly');state.night=false;state.nightAuto=false;state.comfort=d.has('stairs')||d.has('slopes');state.stairs=d.has('stairs')||state.profile!=='WALK';state.slopes=d.has('slopes');close();await showTab('map');await calculate();}
  else if(form.dataset.form==='signup'){
    if(value('password')!==value('passwordConfirm'))throw new Error('비밀번호 확인이 일치하지 않습니다.');
    if(auth){const result=await auth.auth.signUp({email:value('email'),password:value('password'),options:{data:{nickname:value('nickname').trim(),district:value('district')}}});if(result.error)throw new Error('회원가입에 실패했습니다. 입력 정보와 잠시 후 재시도를 확인해주세요.');if(result.data.session)await auth.auth.signOut({scope:'local'});login();toast('가입 요청을 보냈어요. 이메일 인증 안내를 확인한 후 로그인해주세요.');}
    else{await api.call('/auth/signup','POST',{email:value('email'),password:value('password'),nickname:value('nickname'),district:value('district')});login();toast('가입이 완료됐어요. 이메일과 비밀번호로 로그인해주세요.');}
  }
  else if(form.dataset.form==='login'){
    if(auth){const result=await auth.auth.signInWithPassword({email:value('email'),password:value('password')});if(result.error||!result.data.session)throw new Error('이메일과 비밀번호 또는 이메일 인증을 확인해주세요.');api.token=result.data.session.access_token;try{state.user=await api.call('/me');state.user={...state.user!,nickname:result.data.user.user_metadata.nickname,district:result.data.user.user_metadata.district};}catch(e){await auth.auth.signOut({scope:'local'});api.token='';throw e;}}
    else{const result=await api.call<{token:string;user:NonNullable<typeof state.user>}>('/auth/login','POST',{email:value('email'),password:value('password')});api.token=result.token;state.user=result.user;}
    close();if(resumeReport){resumeReport=false;newReport();}else await showTab('profile');toast('로그인했어요. 반가워요, 이웃님!');
  }
  else if(form.dataset.form==='token'&&import.meta.env.MODE!=='production'){const token=value('token').trim();api.token=token;try{state.user=await api.call('/me');}catch(e){api.token='';throw e;}close();await showTab('profile');}
  else if(form.dataset.form==='save'){await api.call('/me/routes','POST',{name:value('name'),search:search()});close();toast('자주 걷는 길에 저장했어요.');}
  else if(form.dataset.form==='flag'){await api.call('/reports/'+form.dataset.report+'/flags','POST',{reason:value('reason')});close();toast('신고가 접수되었어요. 운영자가 확인할게요.');}
  else if(form.dataset.form==='report'){
    captureDraft();if(photosBusy)throw new Error('사진을 처리하고 있어요. 잠시 후 등록해주세요.');if(!state.selected)throw new Error('제보할 위치를 먼저 선택해주세요.');if(!state.user){resumeReport=true;login();return;}
    const description=reportDraft.description.trim();const body={title:description.split('\n')[0].slice(0,60),description,type:reportDraft.type,position:state.selected,photos:reportDraft.photos};const json=JSON.stringify(body);
    if(pendingReport?.body!==json)pendingReport={key:crypto.randomUUID(),body:json};await api.call<Report>('/reports','POST',body,pendingReport.key);pendingReport=undefined;reportDraft={type:'ROAD_DAMAGE',description:'',photos:[]};
    void refreshItems().catch(()=>{});sheet('제보가 등록되었어요!','<img class="success-mascot" src="'+asset('66-1679','imgImage1','png')+'" alt="등록을 축하하는 핑크 날개말"><div class="success-check">'+icon('66-1679')+'</div><h2>제보가 등록되었어요!</h2><p>소중한 제보 덕분에<br>우리 동네가 더 안전해지고 있어요.</p><button class="primary" data-action="tab" data-value="reports">제보 목록 보기</button><button class="success-map" data-action="tab" data-value="map">지도로 돌아가기</button>','success-sheet');
  }

}
async function openShowcase(id:string){
  const preset=showcases.find(s=>s.id===id);if(!preset)return;
  if(demoMode){location.href='/?showcase='+preset.id;return;}
  Object.assign(state,showcaseOptions(id),{origin:preset.origin,destination:preset.destination,routeOpen:true,nightAuto:false,transport:'WALK'});viaNodes=[];close();await showTab('map');await calculate();
}
async function init(){
  if(demoMode){state.routeOpen=!filmMode;state.origin=demoOrigin;state.destination=demoDestination;state.night=false;state.nightAuto=false;}
  api=new Api({...await loadSettings(),...(filmMode?{apiUrl:'/film'}:{})});renderRoute();
  try{state.coverage=await api.call<Coverage>('/map/coverage');await refreshItems();$('#connection').textContent=demoMode?'실제 도로 경로 · 위치 이동 재현':'월계1동 공개자료 연결 · 현재 통행 상태는 현장 확인 필요';}
  catch(e){$('#connection').classList.add('connection-error');$('#connection').textContent='서버 연결 실패 · 연결 설정을 확인하세요';state.error=(e as Error).message;renderRoute();}
  try{await loadKakao(api.settings.kakaoKey);if(!state.coverage)throw new Error('서버가 연결되면 월계1동 지도 정보를 표시할 수 있어요.');map=new WalkingMap($('#map'),state.coverage,pickPosition);draw();map.fit();if(freshPosition())map.position(state.position!,true);if(demoMode)await calculate();else if(new URLSearchParams(location.search).has('showcase'))await openShowcase(new URLSearchParams(location.search).get('showcase')!);}
  catch(e){$('#map').innerHTML=`<div id="map-message"><p>${esc((e as Error).message)}</p><button data-action="settings">카카오 지도 연결 설정</button></div>`;}
}
if(Capacitor.isNativePlatform())void App.addListener('appStateChange',({isActive})=>{if(!isActive){void stopMapWatch(false);if(state.guiding)void stopGuidance();auth?.auth.stopAutoRefresh();}else{auth?.auth.startAutoRefresh();if(mapTrackingRequested)void startMapWatch();}});
if(Capacitor.isNativePlatform())void App.addListener('backButton',()=>{if($<HTMLDialogElement>('#sheet').open)close();else if(!$('#nearby-panel').hidden)closeNearby();else if(state.tab!=='map')void showTab('map');else void App.minimizeApp();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$<HTMLDialogElement>('#sheet').open&&!$('#nearby-panel').hidden)closeNearby();});
document.addEventListener('visibilitychange',()=>{if(document.hidden){void stopMapWatch(false);if(state.guiding)void stopGuidance();}else{if(!freshPosition()&&state.position)expirePosition();if(mapTrackingRequested)void startMapWatch();void syncDaylight().catch(e=>toast(e.message));}});
setInterval(()=>{if(!document.hidden)void syncDaylight().catch(e=>toast(e.message));},30000);
window.addEventListener('offline',()=>{++routeGeneration;state.routes=[];state.items=[];itemsLoaded=false;nearbyStatus='data-error';renderNearby();state.busy=false;state.error='인터넷 연결이 끊겨 경로 안내를 중지했습니다.';void stopGuidance();draw();$('#connection').classList.add('connection-error');$('#connection').textContent='오프라인 · 경로와 시설의 최신 상태를 확인할 수 없습니다';toast(state.error);});
window.addEventListener('online',()=>{toast('다시 연결되었습니다. 길찾기에서 경로를 다시 선택해주세요.');$('#connection').classList.remove('connection-error');$('#connection').textContent='온라인 · 최신 정보 확인 중';void refreshItems().then(()=>{$('#connection').textContent=demoMode?'실제 도로 경로 · 위치 이동 재현':'월계1동 공개자료 연결 · 현재 통행 상태는 현장 확인 필요';}).catch(e=>toast(e.message));});
void init().catch(e=>{toast(e.message);});

async function syncDaylight(){
  const night=daylight().night;if(demoMode||!state.nightAuto||night===state.night)return;
  state.night=night;await calculate();toast(night?'해가 져서 안심귀갓길로 전환했어요. 새 경로를 확인해주세요.':'해가 떠서 낮길로 전환했어요.');
}
function updateGuidance(p:Position){
  const r=current();if(!r)return;const progress=routeProgress(r.geometry.coordinates,p);if(!progress)return;
  if(progress.arrived){void stopGuidance();toast('도착했어요. 총총과 함께 걸어주셔서 고마워요!');return;}
  map?.guidePosition(p,r,state.night);renderProgress(progress,r);const el=document.querySelector('#guide-message');
  if(el)el.textContent=progress.offRouteM>40?'경로에서 벗어났어요. 현재 위치를 출발지로 다시 선택해주세요.':(state.night?'반딧불이를 따라 총총 · 남은 거리 ':'고양이를 따라 총총 · 남은 거리 ')+Math.round(progress.remainingM)+'m';
}

async function previewRoute(){
  const r=current();if(!r||r.geometry.coordinates.length<2)return;await stopGuidance(false);close();
  previewing=true;state.guiding=true;renderRoute();$('#route-card').scrollTop=0;const [lng,lat]=r.geometry.coordinates[0];const start={lat,lng};map?.focusPoint(start);$('#facility-message').textContent=state.night?'등록된 가로등·안심벨과 보행 폭을 고려한 경로예요':'계단·경사를 확인하며 초록 길을 따라가세요';const began=performance.now();
  const tick=()=>{const p=routeProgress(r.geometry.coordinates,start,(filmMode&&state.night?Math.max(0,routeProgress(r.geometry.coordinates,start)!.totalM-140):0)+(performance.now()-began)/1000*(demoMode?1.3:5));if(!p)return;map?.position(p.guide,true,'미리보기');map?.guidePosition(p.guide,r,state.night);const live=routeProgress(r.geometry.coordinates,p.guide);if(live)renderProgress(live,r);const status=document.querySelector('#guide-message');if(status)status.textContent=state.night?'반딧불이를 따라 이동하고 있어요':'고양이와 함께 낮길을 걷고 있어요';const progress=routeProgress(r.geometry.coordinates,p.guide);if(progress?.arrived){void stopGuidance();toast('이동 미리보기가 끝났어요.');}};
  tick();previewTimer=setInterval(tick,100);
}

function renderProgress(progress:NonNullable<ReturnType<typeof routeProgress>>,r:Route){
 const seconds=Math.ceil(r.estimatedDurationSec*progress.remainingM/Math.max(1,progress.totalM));
 $('#remaining-time').textContent=Math.max(1,Math.ceil(seconds/60))+'분';$('#remaining-distance').textContent='남은 거리 '+distanceLabel(progress.remainingM);$('#arrival-time').textContent=eta(seconds)+' 도착';
 $<HTMLProgressElement>('#route-progress').value=Math.max(0,Math.min(100,100*(1-progress.remainingM/Math.max(1,progress.totalM))));
 const replan=document.querySelector<HTMLElement>('#replan-current');if(replan)replan.hidden=progress.offRouteM<=40;const maneuver=nextManeuver(r.geometry.coordinates,progress.alongM);$('#guide-title').textContent=progress.offRouteM>40?'경로를 벗어났어요':maneuver.text;const arrow=document.querySelector('#guide-arrow');if(arrow)arrow.textContent=maneuver.arrow;
 $('#guide-subtitle').textContent=progress.offRouteM>40?'현재 위치에서 경로를 다시 선택해주세요':state.night?'반딧불이가 앞에서 함께해요':'월계1동 보행길을 따라 총총';
}

async function wireframeAction(a:string,v:string,b:HTMLElement):Promise<boolean>{
  if(a==='showcase'){sheet('시연 추천 경로',showcaseView());return true;}
  if(a==='showcase-open'){await openShowcase(v);return true;}
  if(a==='feedback-close'){$<HTMLDialogElement>('#feedback').close();}
  else if(a==='search-open'){planning=false;openSearch();}
  else if(a==='search-clear'){sheet('장소 검색',searchView());}
  else if(a==='category-search'){if(v==='안전시설'){close();await showSafety();}else await runSearch('월계동 '+v);}
  else if(a==='clear-history'){writeLocal('history',[]);sheet('장소 검색',searchView());}
  else if(a==='recent-place'||a==='search-result'||a==='saved-place'||a==='planner-recent'){const rows=a==='search-result'?searchResults:a==='saved-place'?savedPlaces():historyPlaces();const p=rows.find(p=>p.id===v);if(p){if(planning||a==='planner-recent')await choosePlace(p,a==='planner-recent'?'destination':searchSide);else placeDetail(p);}}
  else if(a==='place-endpoint'&&selectedPlace){planning=true;await choosePlace(selectedPlace,v);}
  else if(a==='place-save'&&selectedPlace){const saved=toggleSavedPlace(selectedPlace);b.setAttribute('aria-pressed',String(saved));draw();toast(saved?'이 기기에 장소를 저장했어요.':'저장한 장소에서 해제했어요.');}
  else if(a==='saved-places')savedPlacesView();
  else if(a==='place-share'&&selectedPlace){await sharePlace(selectedPlace);}
  else if(a==='report-share'){const r=await api.call<Report>('/reports/'+v);await sharePlace({id:r.id,name:r.title,position:r.position});}
  else if(a==='swap-endpoints'){[state.origin,state.destination]=[state.destination,state.origin];viaNodes.reverse();showPlanner();}
  else if(a==='add-waypoint'){if(viaNodes.length<3)openSearch('via');}
  else if(a==='remove-waypoint'){viaNodes.splice(Number(v),1);showPlanner();}
  else if(a==='calculate-route'){planning=false;close();state.routeOpen=true;await showTab('map');await calculate();}
  else if(a==='choose-map'||a==='report-pick-map'){captureDraft();mapPicking=a==='report-pick-map'?'report':!state.origin?'origin':'destination';close();state.routeOpen=false;await showTab('map');renderRoute();$('#map-pick-hint').hidden=false;$('#map-pick-hint span').textContent=mapPicking==='report'?'제보할 위치를 지도에서 눌러주세요':'선택할 장소를 지도에서 눌러주세요';}
  else if(a==='cancel-map-pick'){const report=mapPicking==='report';mapPicking='';$('#map-pick-hint').hidden=true;if(report)newReport();else showPlanner();}
  else if(a==='remove-photo'){captureDraft();reportDraft.photos.splice(Number(v),1);newReport();}
  else if(a==='flag-report'){if(!requireUser())return true;sheet('부적절한 제보 신고','<form data-form="flag" data-report="'+esc(v)+'"><label for="flag-reason">신고 사유</label><textarea id="flag-reason" name="reason" minlength="2" maxlength="500" required placeholder="어떤 점이 부적절한지 알려주세요."></textarea><div class="form-error" role="alert"></div><button class="primary" type="submit">신고 접수</button></form>');}
  else if(a==='map-settings'){sheet('지도 설정','<div class="chips">'+mapKinds.map(([v,n])=>'<button data-action="layer" data-value="'+v+'" class="'+(layers.has(v)?'active':'')+'">'+n+'</button>').join('')+'</div><button class="secondary" data-action="saved-places">저장한 장소 보기</button>');}
  else if(a==='preference'){const key=v as keyof Preferences;preferences[key]=!preferences[key];writeLocal('preferences',preferences);b.setAttribute('aria-checked',String(preferences[key]));if(key==='location'&&!preferences.location){await stopMapWatch();await stopGuidance();clearTimeout(fixExpiry);map?.clearPosition();state.position=null;state.positionAt=0;nearbyStatus='unavailable';renderNearby();}draw();}
  else if(a==='location-info'){sheet('위치 사용','<p class="notice">위치를 켜면 현재 위치와 길 안내에 GPS를 사용합니다. 기기 권한은 현재 위치를 누를 때 요청하며, 여기서 끄면 앱의 위치 조회와 안내를 멈춥니다.</p><button class="primary" data-action="locate">현재 위치 확인</button>');}
  else if(a==='notification-info'){sheet('안전 소식 알림','<p class="notice">화면을 켜고 안심귀갓길을 안내받는 동안 주변 시설 정보를 알려드려요. 기기 푸시 알림은 지원하지 않습니다.</p>');}
  else if(a==='safe-route'){selectPreference(state,'NIGHT');state.verifiedOnly=false;state.nightAuto=false;showPlanner();}
  else return false;
  return true;
}
async function sharePlace(place:Place){const url='https://map.kakao.com/link/map/'+encodeURIComponent(place.name)+','+place.position.lat+','+place.position.lng;try{if(navigator.share)await navigator.share({title:place.name,url});else{await navigator.clipboard.writeText(url);toast('장소 링크를 복사했어요.');}}catch(e){if((e as Error).name!=='AbortError')toast('공유할 수 없어요. 잠시 후 다시 시도해주세요.');}}
document.addEventListener('input',e=>{if((e.target as HTMLElement).id==='description'){captureDraft();$('#description-count').textContent=String(reportDraft.description.length);}});
document.addEventListener('change',e=>{const input=e.target as HTMLInputElement;if(input.id!=='report-photos')return;captureDraft();const files=Array.from(input.files??[]);if(files.length+reportDraft.photos.length>2){toast('사진은 최대 2장까지 첨부할 수 있어요.');input.value='';return;}photosBusy=true;input.disabled=true;void Promise.all(files.map(preparePhoto)).then(photos=>{reportDraft.photos.push(...photos);newReport();}).catch(e=>toast(e.message)).finally(()=>{photosBusy=false;input.disabled=false;});});
document.addEventListener('click',e=>{const target=e.target as HTMLElement;if(!e.composedPath().includes($('#layer-menu'))&&!target.closest('[data-action=layers]')){$('#layer-menu').hidden=true;document.querySelector('[data-action=layers]')?.setAttribute('aria-expanded','false');}});

