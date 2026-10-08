import type { Position } from './types';
export function distanceM(a:Position,b:Position){
  const r=Math.PI/180,dy=(b.lat-a.lat)*r,dx=(b.lng-a.lng)*r;
  const h=Math.sin(dy/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dx/2)**2;
  return 6371000*2*Math.atan2(Math.sqrt(h),Math.sqrt(1-h));
}
export function usableFix(accuracy:number,timestamp:number,now=Date.now()){
  return Number.isFinite(accuracy)&&accuracy>=0&&accuracy<=50&&Number.isFinite(timestamp)&&now-timestamp<=30000&&timestamp-now<=5000;
}
