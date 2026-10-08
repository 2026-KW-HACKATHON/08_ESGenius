import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseSeoulSheet,type Notice,type NoticeCatalog} from '../src/construction-notices.js';
import {insideDataset} from '../src/geo.js';
import type {Dataset} from '../src/schemas.js';

const endpoint='https://data.seoul.go.kr/dataList/dataView.do';
const sourceUrl='https://data.seoul.go.kr/dataList/OA-1222/A/1/datasetView.do';
const data=JSON.parse(readFileSync('data/wolgye1.dataset.json','utf8')) as Dataset;
const rows=new Map<string,Record<string,string>>(),queries=[];
for(const term of ['월계','광운','석계','영축']){
  const body=new URLSearchParams({onepagerow:'1000',infId:'OA-1222',srvType:'S',serviceKind:'1',pageNo:'1',ssUserId:'SAMPLE_VIEW',strOrderby:'BIZ_BGNG_YMD DESC',filterCol:'BIZ_NM',txtFilter:term});
  const response=await fetch(endpoint,{method:'POST',body,signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw new Error('Construction projects collection failed: '+response.status);
  const raw=await response.text(),parsed=parseSeoulSheet(raw);
  queries.push({term,count:parsed.list.length,sha256:createHash('sha256').update(raw).digest('hex')});
  for(const row of parsed.list){if(!row.BIZ_CD||!row.BIZ_NM)throw new Error('Unexpected project schema');rows.set(row.BIZ_CD,row);}
}
if(!rows.size)throw new Error('No projects returned; previous snapshot preserved');
const collectedAt=new Date().toISOString(),items:Notice[]=[],rejected=[];
const iso=(d:string)=>d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8);
for(const row of rows.values()){
  const period=row.BIZ_PRD?.match(/^(\d{8})~(\d{8})$/);
  const position={lat:Number(row.LAT),lng:Number(row.LNG)};
  if(!period||period[1]!>period[2]!||!Number.isFinite(position.lat)||!Number.isFinite(position.lng)){rejected.push({id:row.BIZ_CD,reason:'Invalid period or coordinates'});continue;}
  // Official project coordinates are reference markers, never a work perimeter.
  if(!insideDataset(position,data)){rejected.push({id:row.BIZ_CD,reason:'Outside Wolgye1 boundary'});continue;}
  const detailUrl='https://cis.seoul.go.kr/TotalAlimi_new/PopInfo.action?cmd=info1&pjt_cd='+encodeURIComponent(row.BIZ_CD!);
  let startsOn=iso(period[1]!),endsOn=iso(period[2]!),detailHash:string|undefined;
  const detail=await fetch(detailUrl,{signal:AbortSignal.timeout(20000)});
  const html=detail.ok?await detail.text():'';
  const latest=html.match(/<th[^>]*>공사기간<\/th>[\s\S]{0,150}?<td[^>]*>\s*<div[^>]*>(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  if(latest&&latest[1]!<=latest[2]!){startsOn=latest[1]!;endsOn=latest[2]!;detailHash=createHash('sha256').update(html).digest('hex');}
  queries.push({term:row.BIZ_CD!,count:latest?1:0,sha256:detailHash??createHash('sha256').update(html).digest('hex')});
  items.push({id:'cis-'+row.BIZ_CD,permitNo:row.BIZ_CD!,title:row.BIZ_NM!,district:row.SGG_NM!,dong:'월계동',startsOn,endsOn,
    administrativeStatus:'건설알림이 사업 등록',roadKinds:[],pavements:[],position,region:'WOLGYE1',
    ...(row.SITE_ADDR&&row.SITE_ADDR!=='null'?{address:row.SITE_ADDR}:{}),pedestrianControl:'UNVERIFIED',routingEligible:false,locationKind:'PROJECT_POINT',
    locationNote:'건설알림이의 사업 대표 좌표입니다. 주소가 현장과 다르거나 사업 구간이 넓을 수 있어 지도 안내에만 사용하며 자동 우회에는 사용하지 않습니다.',
    sourceUrl:latest?detailUrl:sourceUrl,sourceName:'서울특별시 · 건설알림이 (OA-1222)',collectedAt});
}
const catalog:NoticeCatalog & {collection:unknown}={collectedAt,sourceUrl,sourceName:'서울특별시 · 건설알림이 (OA-1222)',license:'공공누리 제1유형 · 서울특별시 출처표시',rawCount:rows.size,items,collection:{endpoint,queries,rejected,periodPolicy:'Live project-detail period takes precedence over the open-data snapshot; no completion status is inferred.'}};
const target='data/wolgye-construction-projects.json';writeFileSync(target+'.tmp',JSON.stringify(catalog,null,2)+'\n');renameSync(target+'.tmp',target);
console.log(JSON.stringify({uniqueProjects:rows.size,wolgye1:items.length,current:items.filter(n=>n.startsOn<=collectedAt.slice(0,10)&&n.endsOn>=collectedAt.slice(0,10)).map(n=>({id:n.id,title:n.title,startsOn:n.startsOn,endsOn:n.endsOn})),rejected}));
