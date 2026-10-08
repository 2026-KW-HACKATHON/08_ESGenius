import * as SunCalc from 'suncalc';
import { distanceM } from './location';
import type { Position } from './types';

export const WOLGYE = { lat:37.6218, lng:127.0594 };

/** Relative bends from the actual route polyline, without inventing road names. */
export function nextManeuver(coords:[number,number][],alongM:number){
  const points=coords.map(([lng,lat])=>({lng,lat})),cumulative=[0];
  for(let i=1;i<points.length;i++)cumulative.push(cumulative[i-1]+distanceM(points[i-1],points[i]));
  const total=cumulative.at(-1)??0,remaining=Math.max(0,total-alongM);
  if(remaining<15)return {text:'목적지에 도착했어요',arrow:'⚑',distanceM:0,kind:'ARRIVE'};
  const at=(offset:number)=>{offset=Math.max(0,Math.min(total,offset));let i=1;while(i<cumulative.length-1&&cumulative[i]<offset)i++;const a=points[i-1],b=points[i];if(!a||!b)return points[0];const t=(offset-cumulative[i-1])/(cumulative[i]-cumulative[i-1]||1);return {lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t};};
  const bearing=(a:Position,b:Position)=>Math.atan2((b.lng-a.lng)*Math.cos(a.lat*Math.PI/180),b.lat-a.lat)*180/Math.PI;
  let lastTurn=-Infinity;
  for(let i=1;i<points.length-1;i++){
    const offset=cumulative[i];if(offset<12||offset>total-12||offset-lastTurn<18)continue;
    const angle=((bearing(points[i],at(offset+12))-bearing(at(offset-12),points[i])+540)%360)-180;
    if(Math.abs(angle)<40)continue;lastTurn=offset;if(offset<alongM+4)continue;
    const distance=Math.max(5,Math.round((offset-alongM)/5)*5);if(distance>150)break;
    const kind=Math.abs(angle)>150?'UTURN':angle>0?'RIGHT':'LEFT';
    return {text:`${distance}m 앞 ${kind==='UTURN'?'돌아서 이동':kind==='RIGHT'?'오른쪽으로 이동':'왼쪽으로 이동'}`,arrow:kind==='UTURN'?'↶':kind==='RIGHT'?'↱':'↰',distanceM:distance,kind};
  }
  return {text:remaining<=150?`${Math.max(5,Math.round(remaining/5)*5)}m 앞 목적지`:'경로를 따라 계속 이동하세요',arrow:'↑',distanceM:remaining,kind:'STRAIGHT'};
}
export function daylight(now=new Date()) {
  // Anchor the solar day to noon in Seoul, independent of the device timezone.
  const day=new Date(+now+9*3600000).toISOString().slice(0,10);
  const times=SunCalc.getTimes(new Date(day+'T12:00:00+09:00'),WOLGYE.lat,WOLGYE.lng);
  return {night:+now<+times.sunrise!||+now>=+times.sunset!,sunset:times.sunset!,sunrise:times.sunrise!};
}
export function routeProgress(coords:[number,number][], position:Position, aheadM=18) {
  const points=coords.map(([lng,lat])=>({lat,lng}));
  if(points.length<2)return null;
  const lengths=points.slice(1).map((p,i)=>distanceM(points[i],p));
  const total=lengths.reduce((a,b)=>a+b,0);
  let best=Infinity,along=0,passed=0;
  const scale=Math.cos(position.lat*Math.PI/180);
  points.slice(1).forEach((b,i)=>{
    const a=points[i],dx=(b.lng-a.lng)*scale,dy=b.lat-a.lat;
    const t=Math.max(0,Math.min(1,(((position.lng-a.lng)*scale)*dx+(position.lat-a.lat)*dy)/(dx*dx+dy*dy||1)));
    const q={lat:a.lat+(b.lat-a.lat)*t,lng:a.lng+(b.lng-a.lng)*t};
    const d=distanceM(position,q);
    if(d<best){best=d;along=passed+t*lengths[i];}
    passed+=lengths[i];
  });
  const target=Math.min(total,along+aheadM);
  let offset=0,guide=points[points.length-1];
  for(let i=0;i<lengths.length;i++){
    if(offset+lengths[i]>=target){const t=(target-offset)/(lengths[i]||1);guide={lat:points[i].lat+(points[i+1].lat-points[i].lat)*t,lng:points[i].lng+(points[i+1].lng-points[i].lng)*t};break;}
    offset+=lengths[i];
  }
  return {guide,alongM:along,totalM:total,offRouteM:best,remainingM:Math.max(0,total-along),arrived:total-along<15&&distanceM(position,points[points.length-1])<15};
}
