import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

export const constructionSource = 'https://data.seoul.go.kr/dataList/OA-22901/S/1/datasetView.do';
export type Notice = {
  id:string; permitNo:string; title:string; district:string; dong:string;
  startsOn:string; endsOn:string; administrativeStatus:string; roadKinds:string[]; pavements:string[];
  address?:string; position?:{lat:number;lng:number}; region:'WOLGYE1'|'OTHER_WOLGYE'|'UNVERIFIED';
  locationNote:string; pedestrianControl:'UNVERIFIED';
  sourceUrl?:string;sourceName?:string;collectedAt?:string;locationKind?:'PROJECT_POINT';routingEligible?:boolean;
};
export type NoticeCatalog = {collectedAt:string; sourceUrl:string; sourceName:string; license:string; rawCount:number; items:Notice[]};

// Seoul's sheet returns object notation, not strict JSON. Quote keys/remove trailing
// commas outside string tokens only; never execute downloaded JavaScript.
export function parseSeoulSheet(text:string):{result:string;page:{totalCount:number};list:Record<string,string>[]} {
  const quoted=text.replace(/("(?:\\.|[^"\\])*")|([A-Za-z_]\w*)(\s*:)/g,(all,s,key,colon)=>s??JSON.stringify(key)+colon)
    .replace(/("(?:\\.|[^"\\])*")|,(\s*[}\]])/g,(all,s,end)=>s??end);
  const result=JSON.parse(quoted.trim());
  if(result.result!=='ok'||!Array.isArray(result.list)||!Number.isInteger(result.page?.totalCount))throw new Error('Unexpected Seoul sheet response');
  if(result.page.totalCount!==result.list.length)throw new Error('Incomplete source response; existing snapshot preserved');
  return result;
}
export const koreaDate=(date:Date)=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export function noticePeriod(n:Notice,date:Date){const day=koreaDate(date);return day<n.startsOn?'UPCOMING':day>n.endsOn?'PAST_PERIOD':'IN_PERIOD';}
export function normalizeNotices(rows:Record<string,string>[],rejected:Array<{permitNo:string;period:string;reason:string}>=[]):Notice[]{
  const byPermit=new Map<string,Notice>();
  for(const r of rows){
    if(r.ATDRC_ID!=='노원구'||r.ADSTRD_CD!=='월계동')continue;
    const dates=r.CNWPD_DT?.match(/^(\d{4}-\d{2}-\d{2}) ~ (\d{4}-\d{2}-\d{2})$/);
    if(!r.PRMISN_NO||!r.CNW_NM)throw new Error('Invalid permit schema; snapshot not replaced');
    if(!dates||dates[1]!>dates[2]!){rejected.push({permitNo:r.PRMISN_NO,period:r.CNWPD_DT??'',reason:'원자료 공사기간 오류'});continue;}
    const recordKey=[r.PRMISN_NO,r.CNW_NM,r.CNWPD_DT,r.PRCS_STTUS_SE].join('|');
    const existing=byPermit.get(recordKey);
    if(existing){
      if(existing.startsOn!==dates[1]||existing.endsOn!==dates[2]||existing.title!==r.CNW_NM||existing.administrativeStatus!==r.PRCS_STTUS_SE)throw new Error('Conflicting permit records: '+r.PRMISN_NO);
      for(const [key,value] of [['roadKinds',r.ROAD_KND_CD],['pavements',r.ROAD_SE_CD]] as const)if(value&&!existing[key].includes(value))existing[key].push(value);
      continue;
    }
    const address=r.CNW_NM.match(/월계동\s*(산?\d+(?:-\d+)?)(?!\d)/)?.[1];
    byPermit.set(recordKey,{id:'seoul-'+createHash('sha256').update(recordKey).digest('hex').slice(0,20),permitNo:r.PRMISN_NO,title:r.CNW_NM,district:r.ATDRC_ID,dong:r.ADSTRD_CD,
      startsOn:dates[1]!,endsOn:dates[2]!,administrativeStatus:r.PRCS_STTUS_SE??'미확인',roadKinds:[r.ROAD_KND_CD??'미확인'],pavements:[r.ROAD_SE_CD??'미확인'],
      ...(address?{address:'서울특별시 노원구 월계동 '+address}:{}),region:'UNVERIFIED',locationNote:'원자료는 법정동 월계동 기준입니다. 정확한 공사 구간과 행정동은 미확인입니다.',pedestrianControl:'UNVERIFIED'});
  }
  return [...byPermit.values()].sort((a,b)=>b.startsOn.localeCompare(a.startsOn)||a.id.localeCompare(b.id));
}
export function readNotices(now:Date):Omit<NoticeCatalog,'items'|'collectedAt'|'license'>&{collectedAt:string|null;license?:string;available:boolean;stale:boolean;items:(Notice&{period:string})[]}{
  const path=resolve(process.env.CONSTRUCTION_NOTICES_PATH??'data/wolgye-construction-notices.json');
  let catalog:NoticeCatalog;
  try{catalog=JSON.parse(readFileSync(path,'utf8'));}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;return {available:false,collectedAt:null,sourceUrl:constructionSource,sourceName:'서울시 도로굴착 공사 현황',rawCount:0,stale:true,items:[]};}
  let projects:NoticeCatalog|undefined;
  if(!process.env.CONSTRUCTION_NOTICES_PATH||process.env.CONSTRUCTION_PROJECTS_PATH){
    try{projects=JSON.parse(readFileSync(resolve(process.env.CONSTRUCTION_PROJECTS_PATH??'data/wolgye-construction-projects.json'),'utf8'));}
    catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
  }
  const items=[...catalog.items.map(n=>({...n,sourceUrl:catalog.sourceUrl,sourceName:catalog.sourceName,collectedAt:catalog.collectedAt})),...(projects?.items??[])];
  return {...catalog,sourceName:projects?'서울시 도로굴착 · 건설알림이':catalog.sourceName,rawCount:catalog.rawCount+(projects?.rawCount??0),available:true,stale:now.getTime()-Date.parse(catalog.collectedAt)>48*3600000,items:items.map(n=>({...n,period:noticePeriod(n,now)}))};
}
