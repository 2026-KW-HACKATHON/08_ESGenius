import {lineLength} from './geo.js';
import {insideDataset} from './geo.js';
import {readFileSync} from 'node:fs';
import type {Dataset,Position,Edge} from './schemas.js';

export type TerrainFeature={id:string;kind:'STAIRS'|'SLOPE';name:string;description:string;position:Position;source:Edge['source'];segments:{edgeId:string;coordinates:number[][]}[]};
export function extraMapFeatures(data:Dataset):Array<Omit<TerrainFeature,'kind'|'segments'>&{kind:'SLOPE'|'ELEVATOR'}>{
  if(data.isDemo)return [];
  try{const snapshot=JSON.parse(readFileSync('data/wolgye-terrain.json','utf8'));if(snapshot.datasetId!==data.id)return [];return snapshot.items.filter((i:TerrainFeature)=>insideDataset(i.position,data));}
  catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return [];throw e;}
}
export function terrainFeatures(data:Dataset):TerrainFeature[]{
  const grouped=new Map<string,Edge[]>();
  for(const edge of data.edges){
    const kind=edge.stairs?'STAIRS':(edge.slopePercent??0)>0?'SLOPE':null;
    if(!kind)continue;
    // One marker per original OSM way, retaining every graph segment for highlighting.
    const way=edge.id.match(/^osm-(\d+)-/)?.[1]??edge.id,key=kind+'-'+way;
    grouped.set(key,[...(grouped.get(key)??[]),edge]);
  }
  return [...grouped].map(([id,edges])=>{const edge=edges[Math.floor(edges.length/2)]!,kind=id.startsWith('STAIRS')?'STAIRS':'SLOPE';return {id:'terrain-'+id,kind,name:kind==='STAIRS'?'계단 구간':`경사 ${edge.slopePercent}% 구간`,description:kind==='STAIRS'?`공개 도로망에 계단으로 등록된 약 ${Math.round(edges.reduce((n,e)=>n+lineLength(e.geometry),0))}m 구간입니다. 거동 불편·휠체어 경로는 이 계단을 제외합니다.`:'등록된 경사값입니다. 현장 상태와 진행 방향을 확인해주세요.',position:edge.geometry[Math.floor(edge.geometry.length/2)]!,source:edge.source,segments:edges.map(e=>({edgeId:e.id,coordinates:e.geometry.map(p=>[p.lng,p.lat])}))};});
}
