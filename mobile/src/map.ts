import type { Construction, Coverage, MapItem, Position, Route } from './types';
import { routeProgress } from './navigation';
import {markerStyle,clusterItems} from './map-items';
declare global {interface Window {kakao:any}}
let sdk:Promise<void>|undefined;
export async function loadKakao(key:string){
  if(!key)throw new Error('카카오 JavaScript 키를 연결 설정에 입력하면 실제 지도가 표시됩니다.');
  if(window.kakao?.maps?.Map)return;
  if(!sdk)sdk=new Promise<void>((resolve,reject)=>{
    const script=document.createElement('script');
    const timer=setTimeout(()=>reject(new Error('카카오 지도 응답이 없습니다. 키·도메인·인터넷 연결을 확인하세요.')),15000);
    script.src='https://dapi.kakao.com/v2/maps/sdk.js?autoload=false&appkey='+encodeURIComponent(key);
    script.onerror=()=>{clearTimeout(timer);reject(new Error('카카오 지도 로딩 실패. 카카오맵 사용 설정과 등록 도메인을 확인하세요.'));};
    script.onload=()=>{if(!window.kakao?.maps){clearTimeout(timer);reject(new Error('카카오 키 또는 도메인 설정이 맞지 않습니다.'));return;}window.kakao.maps.load(()=>{clearTimeout(timer);resolve();});};
    document.head.append(script);
  });
  return sdk;
}
export class WalkingMap {
  private map:any;private overlays:any[]=[];private user:any;private userContent?:HTMLElement;private selection:any;private observer?:ResizeObserver;
  private guide:any;private swarm:any;private motion=0;private displayedDistance=0;
  private redraw?:()=>void;private drawLevel=0;private night=false;
  private setNight(night:boolean){
    if(this.night===night)return;
    const k=window.kakao.maps,id='CHONGCHONG_NIGHT_SHADE';
    // A tile overlay dims only the basemap, below paths, markers and characters.
    // Kakao's public custom tileset API: https://apis.map.kakao.com/web/sample/getTile/
    if(night&&k.MapTypeId[id]===undefined){
      k.Tileset.add(id,new k.Tileset({width:256,height:256,getTile:()=>{
        const tile=document.createElement('div');tile.className='night-map-tile';
        tile.setAttribute('aria-hidden','true');return tile;
      }}));
    }
    if(night)this.map.addOverlayMapTypeId(k.MapTypeId[id]);
    else this.map.removeOverlayMapTypeId(k.MapTypeId[id]);
    this.night=night;
  }
  clearGuide(){cancelAnimationFrame(this.motion);this.guide?.setMap(null);this.swarm?.setMap(null);this.guide=undefined;this.swarm=undefined;}
  guidePosition(p:Position,route:Route,night=false){
    const progress=routeProgress(route.geometry.coordinates,p,30);
    if(!progress||progress.offRouteM>40){this.clearGuide();return progress;}
    const k=window.kakao.maps;
    if(!this.guide){
      const content=document.createElement('div');content.className=night?'guide-firefly':'guide-day';content.setAttribute('aria-label',night?'경로 앞에서 안내하는 반딧불이':'경로 앞에서 안내하는 고양이');
      content.innerHTML=night?'<span class="guide-halo"></span><img class="guide-asset-glow" src="/figma/current/78-6-imgImage1.png" alt=""><img class="guide-character" src="/figma/current/78-6-imgImage1.png" alt=""><span class="guide-caption">이쪽으로 총총</span>':'<img src="/figma/current/66-817-imgImage1.png" alt="낮길 안내 고양이"><span>총총 따라오세요</span>';
      this.guide=new k.CustomOverlay({map:this.map,position:new k.LatLng(progress.guide.lat,progress.guide.lng),content,yAnchor:1,zIndex:7});
      if(night){const swarm=document.createElement('div');swarm.className='guide-swarm';swarm.setAttribute('aria-hidden','true');swarm.innerHTML='<i></i><i></i><i></i>';
      this.swarm=new k.CustomOverlay({map:this.map,position:new k.LatLng(p.lat,p.lng),content:swarm,yAnchor:.5,zIndex:6});}
      this.displayedDistance=Math.min(progress.totalM,progress.alongM+30);
    }
    this.swarm?.setPosition(new k.LatLng(p.lat,p.lng));cancelAnimationFrame(this.motion);
    const from=this.displayedDistance,to=Math.min(progress.totalM,progress.alongM+30),start=performance.now();
    const [lng,lat]=route.geometry.coordinates[0],origin={lat,lng};
    const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
    const frame=(now:number)=>{const t=reduced?1:Math.min(1,(now-start)/700);this.displayedDistance=from+(to-from)*t;const point=routeProgress(route.geometry.coordinates,origin,this.displayedDistance)!.guide;this.guide?.setPosition(new k.LatLng(point.lat,point.lng));if(t<1)this.motion=requestAnimationFrame(frame);};
    this.motion=requestAnimationFrame(frame);return progress;
  }
  constructor(private el:HTMLElement,private coverage:Coverage,onPick:(p:Position)=>void){
    const k=window.kakao.maps;this.map=new k.Map(el,{center:new k.LatLng(37.6218,127.0594),level:4});
    k.event.addListener(this.map,'click',(e:any)=>onPick({lat:e.latLng.getLat(),lng:e.latLng.getLng()}));
    k.event.addListener(this.map,'idle',()=>{if(this.drawLevel!==this.map.getLevel())this.redraw?.();});
    this.observer=new ResizeObserver(()=>{this.map.relayout();if(this.user&&!document.querySelector<HTMLElement>('#nearby-panel')?.hidden)this.centerUser(this.user.getPosition());});this.observer.observe(el);
  }
  destroy(){this.clearGuide();this.setNight(false);this.observer?.disconnect();this.overlays.forEach(o=>o.setMap(null));this.user?.setMap(null);this.selection?.setMap(null);}
  zoom(){this.map.setLevel(Math.max(1,this.map.getLevel()-1));}
  clearPosition(){this.user?.setMap(null);this.user=undefined;this.userContent=undefined;}
  selectedPosition(p:Position,label='선택 위치'){
    this.selection?.setMap(null);const k=window.kakao.maps,content=document.createElement('div');
    content.className='current-location-capybara selected-location-capybara';
    content.setAttribute('role','img');content.setAttribute('aria-label',label+' · 카피바라');
    content.innerHTML='<img src="/figma/current/66-2-imgImage.png" alt=""><b hidden></b>';
    this.selection=new k.CustomOverlay({map:this.map,position:new k.LatLng(p.lat,p.lng),content,yAnchor:1,zIndex:6});
    this.focusPoint(p);
  }
  focusPoint(p:Position){this.map.setLevel(3);this.map.panTo(new window.kakao.maps.LatLng(p.lat,p.lng));}
  focusUser(p:Position){this.map.setLevel(3);this.position(p,true);}
  private centerUser(point:any){
    const panel=document.querySelector<HTMLElement>('#nearby-panel');
    if(!panel||panel.hidden){this.map.panTo(point);return;}
    const projection=this.map.getProjection(),pixel=projection.containerPointFromCoords(point);
    const visibleHeight=this.el.clientHeight-panel.getBoundingClientRect().height;
    const targetY=Math.max(110,visibleHeight*.65);
    // Keep the character and its label above the sheet, including short screens.
    const center=projection.coordsFromContainerPoint(new window.kakao.maps.Point(pixel.x,pixel.y+this.el.clientHeight/2-targetY));
    this.map.panTo(center);
  }
  focusConstruction(c:Construction){const k=window.kakao.maps,b=new k.LatLngBounds();const points=c.segments?.flatMap(s=>s.coordinates)??[];if(!points.length){this.map.panTo(new k.LatLng(c.position.lat,c.position.lng));return;}for(const p of points)b.extend(new k.LatLng(p[1],p[0]));this.map.setBounds(b,160,50,130,50);}
  position(p:Position,center=false,label='내 위치'){
    const k=window.kakao.maps,point=new k.LatLng(p.lat,p.lng);
    if(!this.user){const content=document.createElement('div');content.className='current-location-capybara';content.setAttribute('role','img');content.innerHTML='<img src="/figma/current/66-2-imgImage.png" alt=""><b></b>';this.userContent=content;this.user=new k.CustomOverlay({map:this.map,position:point,content,yAnchor:1,zIndex:8});}
    else this.user.setPosition(point);
    this.userContent!.setAttribute('aria-label',label+' · 카피바라');
    this.userContent!.dataset.stale=String(label==='위치 갱신 필요');
    this.userContent!.querySelector('b')!.textContent=label;
    this.userContent!.querySelector('b')!.hidden=label==='미리보기';
    if(center)this.centerUser(point);
  }
  draw(route:Route|undefined,items:MapItem[],origin:Position|undefined,destination:Position|undefined,onItem:(i:MapItem)=>void,night=false){
    this.setNight(night);
    this.redraw=()=>this.draw(route,items,origin,destination,onItem,night);this.drawLevel=this.map.getLevel();
    this.overlays.forEach(o=>o.setMap(null));this.overlays=[];const k=window.kakao.maps;
    const path=(coords:number[][])=>coords.map(p=>new k.LatLng(p[1],p[0]));
    if(this.coverage.boundary)this.overlays.push(new k.Polygon({map:this.map,path:path(this.coverage.boundary.coordinates[0]),strokeWeight:2,strokeColor:'#408d70',strokeStyle:'dash',fillColor:'#79b788',fillOpacity:.04}));
    if(route){
      this.overlays.push(new k.Polyline({map:this.map,path:path(route.geometry.coordinates),strokeWeight:18,strokeColor:night?'#fff06a':'#9bc489',strokeOpacity:.35,strokeStyle:'solid'}));
      this.overlays.push(new k.Polyline({map:this.map,path:path(route.geometry.coordinates),strokeWeight:9,strokeColor:night?'#ffe44d':'#79ad68',strokeOpacity:1,strokeStyle:'solid'}));
      this.overlays.push(new k.Polyline({map:this.map,path:path(route.geometry.coordinates),strokeWeight:3,strokeColor:night?'#fff5a0':'#e3f0d2',strokeOpacity:.9,strokeStyle:'solid'}));
    }
    const marker=(p:Position,label:string,className:string,click?:()=>void)=>{const b=document.createElement('button');b.className='map-pin '+className;b.textContent=label;b.setAttribute('aria-label',label);b.onclick=e=>{e.stopPropagation();k.event.preventMap();click?.();};this.overlays.push(new k.CustomOverlay({map:this.map,position:new k.LatLng(p.lat,p.lng),content:b,yAnchor:1.2,zIndex:3}));};
    const annotated=(item:MapItem)=>{
      const style=markerStyle(item.kind),b=document.createElement('button');
      b.className='map-symbol '+style.tone+(style.pin?' pin-symbol':' circle-symbol')+(item.locationKind==='ADDRESS'?' address-symbol':'');
      const kinds=[...new Set(item.members?.map(i=>i.kind)??[])];
      b.setAttribute('aria-label',item.members?'주변 '+kinds.map(k=>markerStyle(k).label).join('·')+' 정보 '+item.members.length+'곳':style.label+' 정보: '+(item.name||item.title||style.label));b.title=item.name||item.title||style.label;
      b.innerHTML='<span class="symbol-art">'+style.icon+'</span>'+(item.members?'<span class="symbol-count">'+item.members.length+'</span><span class="symbol-kinds">'+kinds.filter(k=>k!==item.kind).slice(0,2).map(k=>'<span class="'+markerStyle(k).tone+'">'+markerStyle(k).icon+'</span>').join('')+'</span>':'');
      b.onclick=e=>{e.stopPropagation();k.event.preventMap();onItem(item);};
      this.overlays.push(new k.CustomOverlay({map:this.map,position:new k.LatLng(item.position.lat,item.position.lng),content:b,yAnchor:style.pin?1.1:.5,zIndex:item.kind==='STREETLIGHT'?3:item.kind==='CCTV'?4:5}));
    };
    const step=0.000035*2**this.map.getLevel();
    for(const i of items){
      if(i.kind==='CONSTRUCTION')for(const segment of i.segments??[]){const line=new k.Polyline({map:this.map,path:path(segment.coordinates),strokeWeight:8,strokeColor:i.impact==='BLOCK'?'#d35442':'#d69924',strokeOpacity:.9,strokeStyle:'shortdash',zIndex:2});k.event.addListener(line,'click',()=>onItem(i));this.overlays.push(line);}
    }
    for(const i of clusterItems(items,i=>({x:i.position.lng*.79/step*38,y:i.position.lat/step*38})))annotated(i);
    if(origin)marker(origin,'출발','origin');if(destination)marker(destination,'도착','destination');
  }
  fit(route?:Route){const k=window.kakao.maps,b=new k.LatLngBounds();const coords=route?.geometry.coordinates||[[this.coverage.bbox[0],this.coverage.bbox[1]],[this.coverage.bbox[2],this.coverage.bbox[3]]];for(const p of coords)b.extend(new k.LatLng(p[1],p[0]));const panel=document.querySelector('#route-card');const bottom=route&&panel?panel.getBoundingClientRect().height+20:100;this.map.setBounds(b,85,35,Math.min(bottom,this.el.clientHeight*.65),35);}
}
