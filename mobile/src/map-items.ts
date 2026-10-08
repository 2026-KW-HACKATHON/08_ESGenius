import type {MapItem} from './types';

export const mapKinds=[['STREETLIGHT','가로등·보안등'],['CCTV','CCTV'],['EMERGENCY_BELL','안심벨'],['STAIRS','계단'],['SLOPE','언덕·경사'],['ELEVATOR','엘리베이터'],['CONSTRUCTION','공사 안내'],['REPORT','주민 제보']] as const;
export const layerKind=(kind:string)=>kind==='CONSTRUCTION_NOTICE'?'CONSTRUCTION':kind;
const original=(name:string)=>`<img src="/figma/current/78-6-${name}.svg" alt="">`;
export function markerStyle(kind:string){
  switch(kind){
    case 'STREETLIGHT':return {label:'가로등·보안등',tone:'lamp',icon:original('imgIcon5'),pin:false};
    case 'CCTV':return {label:'CCTV',tone:'camera',icon:original('imgIcon6'),pin:false};
    case 'EMERGENCY_BELL':return {label:'안심벨',tone:'bell',icon:original('imgIcon3'),pin:false};
    case 'STAIRS':return {label:'계단',tone:'stairs',icon:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2 13h4V9h4V5h4M2 5l4-3m-4 0v3h3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',pin:false};
    case 'SLOPE':return {label:'언덕·경사',tone:'slope',icon:original('imgIcon4'),pin:false};
    case 'ELEVATOR':return {label:'엘리베이터',tone:'elevator',icon:'<svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 6h10v8H3zM5 11V8m-2 2 2-2 2 2m3-2v3m-2-2 2 2 2-2M5 3l2-2m2 0 2 2" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>',pin:false};
    case 'SAVED_PLACE':return {label:'저장한 장소',tone:'saved',icon:original('imgIcon2'),pin:true};
    default:return {label:layerKind(kind)==='CONSTRUCTION'?'공사 안내':'주민 제보',tone:'hazard',icon:original('imgIcon1'),pin:true};
  }
}
export function visibleItems(items:MapItem[],layers:Set<string>){return items.filter(i=>layers.has(layerKind(i.kind)));}
export function kindCount(items:MapItem[],kind:string){const rows=items.filter(i=>layerKind(i.kind)===kind),addresses=rows.filter(i=>i.locationKind==='ADDRESS').length;return addresses?`${rows.length-addresses}위치 · ${addresses}주소`:`${rows.length}곳`;}
export function clusterItems(items:MapItem[],project:(i:MapItem)=>{x:number;y:number},cell=38):MapItem[]{
  const groups=new Map<string,MapItem[]>();
  for(const item of items){const p=project(item),key=item.kind==='SAVED_PLACE'?item.id:Math.floor(p.x/cell)+','+Math.floor(p.y/cell);groups.set(key,[...(groups.get(key)??[]),item]);}
  const priority=['CONSTRUCTION','CONSTRUCTION_NOTICE','STAIRS','SLOPE','EMERGENCY_BELL','ELEVATOR','STREETLIGHT','CCTV'];
  return [...groups.values()].map(members=>{if(members.length===1)return members[0]!;members.sort((a,b)=>priority.indexOf(a.kind)-priority.indexOf(b.kind));return {...members[0]!,members};});
}
