import type { Position } from './schemas.js';
import { ApiError } from './errors.js';
export function distance(a: Position, b: Position): number {
  const r = Math.PI / 180;
  const dlat = (b.lat - a.lat) * r, dlng = (b.lng - a.lng) * r;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dlng / 2) ** 2;
  return 6371000 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
export const lineLength = (points: Position[]) => points.slice(1).reduce((sum, p, i) => sum + distance(points[i]!, p), 0);
export function lineDistance(point: Position, points: Position[]) {
  const scaleX=111320*Math.cos(point.lat*Math.PI/180),scaleY=111320;
  return Math.min(...points.slice(1).map((end,i)=>{
    const start=points[i]!;
    const ax=(start.lng-point.lng)*scaleX,ay=(start.lat-point.lat)*scaleY;
    const bx=(end.lng-point.lng)*scaleX,by=(end.lat-point.lat)*scaleY;
    const dx=bx-ax,dy=by-ay;
    const t=Math.max(0,Math.min(1,-(ax*dx+ay*dy)/(dx*dx+dy*dy||1)));
    return Math.hypot(ax+t*dx,ay+t*dy);
  }));
}
export const inside = (p: Position, b: number[]) => p.lng >= b[0]! && p.lat >= b[1]! && p.lng <= b[2]! && p.lat <= b[3]!;
export function insideDataset(p:Position,d:import('./schemas.js').Dataset):boolean {
  if(!inside(p,d.bbox))return false;
  if(!d.boundary)return true;
  const ringContains=(ring:number[][])=>{
    let result=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j]!,b=ring[i]!,ax=a[0]!,ay=a[1]!,bx=b[0]!,by=b[1]!;
      const cross=(p.lng-ax)*(by-ay)-(p.lat-ay)*(bx-ax);
      if(Math.abs(cross)<1e-12&&p.lng>=Math.min(ax,bx)-1e-10&&p.lng<=Math.max(ax,bx)+1e-10&&p.lat>=Math.min(ay,by)-1e-10&&p.lat<=Math.max(ay,by)+1e-10)return true;
      if((ay>p.lat)!==(by>p.lat)&&p.lng<(bx-ax)*(p.lat-ay)/(by-ay)+ax)result=!result;
    }
    return result;
  };
  return ringContains(d.boundary.coordinates[0]!)&&!d.boundary.coordinates.slice(1).some(ringContains);
}
export function parseBbox(value?: string): number[] | undefined {
  if (!value) return;
  const b = value.split(',').map(Number);
  if (b.length !== 4 || b.some(v => !Number.isFinite(v)) || b[0]! >= b[2]! || b[1]! >= b[3]! || b[0]! < -180 || b[2]! > 180 || b[1]! < -90 || b[3]! > 90) {
    throw new ApiError(400, 'INVALID_BBOX', 'bbox는 minLng,minLat,maxLng,maxLat 순서입니다.');
  }
  return b;
}
